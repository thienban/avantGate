import {
  MemoryStorageAdapter,
  createCustomStorageAdapter,
  KeyValueStorageAdapter,
  PrismaStorageAdapter,
  SQLiteStorageAdapter,
  type StepRecord,
} from "../../src/agent";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runStorageAdapterTests() {
  console.log("💾 Testing avantgate/agent Storage Adapters...\n");

  // 1. MemoryStorageAdapter test
  const memory = new MemoryStorageAdapter({ ttlMs: 50 });
  const sampleStep: StepRecord<{ score: number }> = {
    workflowId: "wf-1",
    stepId: "step-1",
    status: "COMPLETED",
    result: { score: 95 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await memory.saveStep(sampleStep);
  const fetched = await memory.getStep<{ score: number }>("wf-1", "step-1");
  assert(fetched?.result?.score === 95, "Memory adapter saves and retrieves step record");

  await memory.updateStepStatus("wf-1", "step-1", "WAITING_APPROVAL", {
    metadata: { reason: "Review needed" },
  });
  const updated = await memory.getStep("wf-1", "step-1");
  assert(updated?.status === "WAITING_APPROVAL", "Memory adapter updates status");
  assert(
    (updated?.metadata as any)?.reason === "Review needed",
    "Memory adapter updates metadata"
  );

  const listed = await memory.listSteps("wf-1");
  assert(listed.length === 1, "Memory adapter lists steps by workflowId");

  // TTL test
  await new Promise((resolve) => setTimeout(resolve, 60));
  const expired = await memory.getStep("wf-1", "step-1");
  assert(expired === null, "Memory adapter respects TTL expiration");

  // 2. Custom functional storage adapter
  const mockDb = new Map<string, any>();
  const customAdapter = createCustomStorageAdapter({
    async getStep(wfId, sId) {
      return mockDb.get(`${wfId}:${sId}`) ?? null;
    },
    async saveStep(step) {
      mockDb.set(`${step.workflowId}:${step.stepId}`, step);
    },
    async updateStepStatus(wfId, sId, status, patch) {
      const prev = mockDb.get(`${wfId}:${sId}`) ?? { workflowId: wfId, stepId: sId };
      mockDb.set(`${wfId}:${sId}`, { ...prev, ...patch, status });
    },
    async listSteps(wfId) {
      return Array.from(mockDb.values()).filter((s) => s.workflowId === wfId);
    },
  });

  await customAdapter.saveStep({
    workflowId: "wf-custom",
    stepId: "step-a",
    status: "RUNNING",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const customFetched = await customAdapter.getStep("wf-custom", "step-a");
  assert(customFetched?.status === "RUNNING", "Custom functional adapter works seamlessly");

  // 3. KeyValueStorageAdapter (Redis / KV style)
  const kvStore = new Map<string, string>();
  const kvClient = {
    get: async (key: string) => kvStore.get(key) ?? null,
    set: async (key: string, value: string) => {
      kvStore.set(key, value);
    },
    keys: async (pattern?: string) => Array.from(kvStore.keys()),
  };

  const kvAdapter = new KeyValueStorageAdapter(kvClient);
  await kvAdapter.saveStep({
    workflowId: "wf-kv",
    stepId: "step-kv-1",
    status: "COMPLETED",
    result: { token: "secret-123" },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const kvFetched = await kvAdapter.getStep<{ token: string }>("wf-kv", "step-kv-1");
  assert(kvFetched?.result?.token === "secret-123", "KeyValue adapter stores serialized JSON");

  // 4. PrismaStorageAdapter (Mocked Delegate)
  const prismaMockStorage = new Map<string, any>();
  const mockPrismaModel = {
    findUnique: async (args: any) => {
      const { workflowId, stepId } = args.where.workflowId_stepId;
      return prismaMockStorage.get(`${workflowId}::${stepId}`) ?? null;
    },
    upsert: async (args: any) => {
      const { workflowId, stepId } = args.where.workflowId_stepId;
      const data = args.create ?? args.update;
      prismaMockStorage.set(`${workflowId}::${stepId}`, data);
      return data;
    },
    findMany: async (args: any) => {
      return Array.from(prismaMockStorage.values()).filter(
        (row) => row.workflowId === args.where.workflowId
      );
    },
  };

  const prismaAdapter = new PrismaStorageAdapter(mockPrismaModel as any);
  await prismaAdapter.saveStep({
    workflowId: "wf-prisma",
    stepId: "s-1",
    status: "COMPLETED",
    result: { prismaValue: 42 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const prismaFetched = await prismaAdapter.getStep<{ prismaValue: number }>("wf-prisma", "s-1");
  assert(prismaFetched?.result?.prismaValue === 42, "Prisma adapter serializes and retrieves records");

  // 5. SQLiteStorageAdapter (Mocked DatabaseLike)
  const sqliteStore = new Map<string, any>();
  const mockSqliteDb = {
    exec: (_sql: string) => {},
    prepare: (sql: string) => ({
      get: (wfId: string, sId: string) => sqliteStore.get(`${wfId}::${sId}`) ?? null,
      run: (wfId: string, sId: string, status: string, result: string, error: string, meta: string, ca: string, ua: string) => {
        sqliteStore.set(`${wfId}::${sId}`, {
          workflow_id: wfId,
          step_id: sId,
          status,
          result,
          error,
          metadata: meta,
          created_at: ca,
          updated_at: ua,
        });
      },
      all: (wfId: string) =>
        Array.from(sqliteStore.values()).filter((r) => r.workflow_id === wfId),
    }),
  };

  const sqliteAdapter = new SQLiteStorageAdapter(mockSqliteDb as any);
  await sqliteAdapter.saveStep({
    workflowId: "wf-sqlite",
    stepId: "step-sq-1",
    status: "COMPLETED",
    result: { count: 10 },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const sqliteFetched = await sqliteAdapter.getStep<{ count: number }>("wf-sqlite", "step-sq-1");
  assert(sqliteFetched?.result?.count === 10, "SQLite adapter saves and parses rows correctly");

  console.log("\n🎉 All Storage Adapter tests passed successfully!");
}

runStorageAdapterTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
