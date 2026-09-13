import assert from "node:assert";
import { z } from "zod";
import { MemoryStorageAdapter } from "../../src/agent/adapters/memory-adapter";
import { PlatformStorageAdapter } from "../../src/agent/adapters/platform-adapter";
import { HttpTelemetryExporter } from "../../src/agent/telemetry/http-exporter";
import type { TelemetryIngestPayload } from "../../src/agent/telemetry/types";
import { createIsolatedTool } from "../../src/agent/isolated-tool";
import { ToolRegistry } from "../../src/agent/registry";
import { createToolInvoker } from "../../src/agent/tool-invoker";
import { createStepRunner } from "../../src/agent/step-runner";
import { StepSuspendedError } from "../../src/agent/errors";

console.log("☁️ Testing avantgate/agent PlatformStorageAdapter & Telemetry Pipeline...");

async function testPlatformAdapterStepMirroring(): Promise<void> {
  const sentPayloads: TelemetryIngestPayload[] = [];

  const mockFetch = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.body) {
      sentPayloads.push(JSON.parse(init.body as string));
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const exporter = new HttpTelemetryExporter({
    apiKey: "ag_test_key",
    agentName: "sales-agent",
    batchIntervalMs: 0,
    fetchFn: mockFetch as any,
  });

  const memoryStorage = new MemoryStorageAdapter();
  const platformAdapter = new PlatformStorageAdapter({
    primaryStorage: memoryStorage,
    exporter,
  });

  const stepRunner = createStepRunner({
    workflowId: "wf-order-99",
    runId: "run-order-99",
    storage: platformAdapter,
  });

  // 1. Run completed step
  const result = await stepRunner.run("validate-inventory", async () => {
    return { inStock: true, count: 42 };
  });
  assert.deepStrictEqual(result, { inStock: true, count: 42 });

  // 2. Wait for approval step
  let suspended = false;
  try {
    await stepRunner.waitForApproval("manager-signoff", {
      metadata: { actionType: "DISCOUNT_APPROVAL", maxDiscount: 20 },
    });
  } catch (err) {
    if (err instanceof StepSuspendedError) {
      suspended = true;
    }
  }
  assert.strictEqual(suspended, true);

  // Flush exporter to send captured events
  await exporter.flush();

  // Verify memory persistence
  const memoryStep = await memoryStorage.getStep("wf-order-99", "validate-inventory");
  assert.ok(memoryStep);
  assert.strictEqual(memoryStep.status, "COMPLETED");

  const approvalStep = await memoryStorage.getStep("wf-order-99", "manager-signoff");
  assert.ok(approvalStep);
  assert.strictEqual(approvalStep.status, "WAITING_APPROVAL");

  // Verify telemetry mirror events
  assert.strictEqual(sentPayloads.length, 1);
  const payload = sentPayloads[0];
  assert.strictEqual(payload.runId, "run-order-99");
  assert.strictEqual(payload.agentName, "sales-agent");

  // Events emitted: STEP_START, STEP_COMPLETED (for validate-inventory), STEP_APPROVAL_REQUEST (for manager-signoff)
  const eventTypes = payload.events.map((e) => e.type);
  assert.ok(eventTypes.includes("STEP_START"), "Must include STEP_START");
  assert.ok(eventTypes.includes("STEP_COMPLETED"), "Must include STEP_COMPLETED");
  assert.ok(eventTypes.includes("STEP_APPROVAL_REQUEST"), "Must include STEP_APPROVAL_REQUEST");

  console.log("✅ PASS: Step lifecycle mirrored to telemetry with local persistence preserved");
}

async function testToolExecutionTelemetryAndPiiCapture(): Promise<void> {
  const sentPayloads: TelemetryIngestPayload[] = [];

  const mockFetch = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.body) {
      sentPayloads.push(JSON.parse(init.body as string));
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const exporter = new HttpTelemetryExporter({
    apiKey: "ag_test_key",
    batchIntervalMs: 0,
    fetchFn: mockFetch as any,
  });

  const memoryStorage = new MemoryStorageAdapter();
  const platformAdapter = new PlatformStorageAdapter({
    primaryStorage: memoryStorage,
    exporter,
  });

  const registry = new ToolRegistry();

  // Tool returning sensitive email PII
  const profileTool = createIsolatedTool({
    id: "tool-profile-01",
    name: "fetch_customer_profile",
    alias: "get_profile",
    description: "Fetches user info",
    parameters: z.object({ customerId: z.string() }),
    async execute(args) {
      return {
        id: args.customerId,
        email: "alice.martin@corporate.fr",
        role: "Director",
      };
    },
    toLLMSummary(res) {
      return { profileFound: true, contact: res.email };
    },
    sanitizePii: true,
  });

  registry.register({
    id: profileTool._toolId,
    name: profileTool._toolName,
    alias: profileTool._toolAlias,
    description: profileTool.description,
    tool: profileTool,
  });

  const invoker = createToolInvoker(registry, platformAdapter, {
    workflowId: "wf-user-profile",
  });

  const res = await invoker.invokeTool<{ profileFound: boolean; contact: string }>(
    "tool-profile-01",
    { customerId: "cust_101" }
  );

  // Verify LLM summary had PII redacted
  assert.strictEqual(res.profileFound, true);
  assert.strictEqual(res.contact, "[REDACTED_EMAIL]");

  // Verify in memory storage
  const executions = await memoryStorage.listToolExecutions("wf-user-profile");
  assert.strictEqual(executions.length, 1);
  const localRecord = executions[0];
  assert.strictEqual(localRecord.toolId, "tool-profile-01");
  assert.strictEqual(localRecord.aliasUsed, "get_profile");
  assert.strictEqual(localRecord.status, "SUCCESS");
  assert.strictEqual(localRecord.piiFilteredCount, 1);

  // Flush exporter and check telemetry mirror
  await exporter.flush();

  assert.strictEqual(sentPayloads.length, 1);
  const payload = sentPayloads[0];
  assert.strictEqual(payload.events.length, 1);

  const toolEvent = payload.events[0] as any;
  assert.strictEqual(toolEvent.type, "TOOL_EXECUTION");
  assert.strictEqual(toolEvent.toolId, "tool-profile-01");
  assert.strictEqual(toolEvent.aliasUsed, "get_profile");
  assert.strictEqual(toolEvent.piiFilteredCount, 1);
  assert.strictEqual(toolEvent.success, true);
  assert.deepStrictEqual(toolEvent.llmSummary, { profileFound: true, contact: "[REDACTED_EMAIL]" });

  console.log("✅ PASS: Tool execution PII filtered count captured and mirrored to telemetry");
}

async function testDelegatedCacheAndBlackboard(): Promise<void> {
  const exporter = new HttpTelemetryExporter({
    apiKey: "ag_key",
    batchIntervalMs: 0,
    fetchFn: (async () => new Response("{}")) as any,
  });

  const memoryStorage = new MemoryStorageAdapter();
  const platformAdapter = new PlatformStorageAdapter({
    primaryStorage: memoryStorage,
    exporter,
  });

  // Test blackboard delegation
  await platformAdapter.setStateValue("testKey", { foo: "bar" });
  const val = await platformAdapter.getStateValue("testKey");
  assert.deepStrictEqual(val, { foo: "bar" });

  await platformAdapter.deleteStateValue("testKey");
  const deletedVal = await platformAdapter.getStateValue("testKey");
  assert.strictEqual(deletedVal, null);

  // Test tool cache delegation
  await platformAdapter.setCachedToolResult("cache_1", { cached: true }, 60);
  const cachedVal = await platformAdapter.getCachedToolResult("cache_1");
  assert.deepStrictEqual(cachedVal, { cached: true });

  console.log("✅ PASS: Blackboard and cache delegation work transparently via PlatformStorageAdapter");
}

async function run(): Promise<void> {
  await testPlatformAdapterStepMirroring();
  await testToolExecutionTelemetryAndPiiCapture();
  await testDelegatedCacheAndBlackboard();
  console.log("\n🎉 All PlatformStorageAdapter tests passed successfully!");
}

void run();
