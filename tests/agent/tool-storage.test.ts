import { z } from "zod";
import {
  createIsolatedTool,
  ToolRegistry,
  createToolInvoker,
  MemoryStorageAdapter,
  SQLiteStorageAdapter,
} from "../../src/agent";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runToolStorageTests() {
  console.log("💾 Testing avantgate/agent Tool Persistence, Cache & Blackboard...\n");

  const storage = new MemoryStorageAdapter();
  const registry = new ToolRegistry();

  let computeCount = 0;
  const expensiveTool = createIsolatedTool({
    id: "heavy_compute",
    name: "heavy_compute",
    description: "Expensive calculation",
    cacheTTL: 60, // 60s cache in DB/memory
    parameters: z.object({ query: z.string() }),
    async execute(args, context) {
      computeCount++;
      // Also store intermediate state in Blackboard
      await context?.state?.set("last_query", args.query);
      return { answer: `Processed ${args.query}`, computeRun: computeCount };
    },
  });

  const parentTool = createIsolatedTool({
    id: "parent_orchestrator",
    name: "parent_orchestrator",
    description: "Parent tool",
    parameters: z.object({ query: z.string() }),
    async execute(args, context) {
      return await context?.callTool("heavy_compute", { query: args.query });
    },
  });

  registry.register({ id: "heavy_compute", name: "heavy_compute", description: "c", tool: expensiveTool });
  registry.register({ id: "parent_orchestrator", name: "parent_orchestrator", description: "p", tool: parentTool });

  const invoker = createToolInvoker(registry, storage, {
    workflowId: "wf-test-db",
    stepId: "step-1",
  });

  // Test 1: First Execution & Hierarchical DB Tracing
  const res1 = await invoker.invokeTool<any>("parent_orchestrator", { query: "finance" });
  assert(res1.computeRun === 1, "First execution computed result");
  assert(computeCount === 1, "Compute function invoked once");

  const traces = await storage.listToolExecutions("wf-test-db", "step-1");
  assert(traces.length === 2, "Recorded 2 tool executions in storage (parent and child)");

  const childTrace = traces.find((t) => t.toolId === "heavy_compute");
  assert(childTrace?.parentToolId === "parent_orchestrator", "Hierarchical link parentToolId recorded in DB trace");
  assert(childTrace?.depth === 2, "Call depth 2 recorded in DB trace");
  assert(childTrace?.status === "SUCCESS", "Execution status is SUCCESS");
  assert(childTrace?.durationMs >= 0, "Execution duration recorded");

  // Test 2: Idempotence Caching (cacheTTL)
  const res2 = await invoker.invokeTool<any>("heavy_compute", { query: "finance" });
  assert(res2.computeRun === 1, "Cached result returned on second call with identical arguments");
  assert(computeCount === 1, "Heavy compute function was NOT re-invoked (cache hit)");

  // Test 3: Blackboard Shared State
  const sharedQuery = await storage.getStateValue("last_query");
  assert(sharedQuery === "finance", "Tool shared state retrieved from storage blackboard");

  // Test 4: SQLite adapter storage verification for tools & cache
  const sqliteMap = new Map<string, any>();
  const mockDb = {
    exec: (_sql: string) => {},
    prepare: (sql: string) => ({
      get: (...params: any[]) => sqliteMap.get(params.join("::")) ?? null,
      all: (..._params: any[]) => Array.from(sqliteMap.values()),
      run: (...params: any[]) => {
        sqliteMap.set(params.slice(0, 2).join("::"), params);
      },
    }),
  };

  const sqliteStorage = new SQLiteStorageAdapter(mockDb as any);
  await sqliteStorage.saveToolExecution({
    executionId: "exec-sql-1",
    workflowId: "wf-sql",
    toolId: "heavy_compute",
    depth: 1,
    durationMs: 15,
    status: "SUCCESS",
    createdAt: new Date().toISOString(),
  });
  await sqliteStorage.setCachedToolResult("test-key", { cached: true }, 60);
  await sqliteStorage.setStateValue("bb-key", { stateValue: 123 }, 60);

  assert(sqliteMap.size > 0, "SQLite adapter saves tool traces, cache and shared state");

  console.log("\n🎉 All Tool Persistence, Cache & Blackboard tests passed successfully!");
}

runToolStorageTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
