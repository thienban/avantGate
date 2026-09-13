import assert from "node:assert";
import { HttpTelemetryExporter } from "../../src/agent/telemetry/http-exporter";
import type { TelemetryIngestPayload } from "../../src/agent/telemetry/types";

console.log("📡 Testing avantgate/agent HttpTelemetryExporter...");

async function testExporterPayloadFormat(): Promise<void> {
  const sentBodies: TelemetryIngestPayload[] = [];
  const sentHeaders: HeadersInit[] = [];

  const mockFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.body) {
      sentBodies.push(JSON.parse(init.body as string));
    }
    if (init?.headers) {
      sentHeaders.push(init.headers);
    }
    return new Response(JSON.stringify({ ok: true, received: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const exporter = new HttpTelemetryExporter({
    apiKey: "ag_live_secret_key_123",
    agentName: "prospect-qualifier",
    batchIntervalMs: 0, // manual flush
    maxBatchSize: 10,
    fetchFn: mockFetch as any,
  });

  exporter.enqueue(
    "run-123",
    {
      type: "STEP_START",
      stepName: "extract-lead",
      timestamp: new Date().toISOString(),
    }
  );

  exporter.enqueue(
    "run-123",
    {
      type: "TOOL_EXECUTION",
      toolId: "crm_lookup",
      toolName: "crm_lookup",
      durationMs: 120,
      success: true,
      piiFilteredCount: 2,
      timestamp: new Date().toISOString(),
    },
    {
      promptTokens: 50,
      completionTokens: 20,
      totalTokens: 70,
      costUsd: 0.0001,
    }
  );

  await exporter.flush();

  assert.strictEqual(sentBodies.length, 1);
  const payload = sentBodies[0];

  assert.strictEqual(payload.runId, "run-123");
  assert.strictEqual(payload.agentName, "prospect-qualifier");
  assert.strictEqual(payload.events.length, 2);
  assert.strictEqual(payload.events[0].type, "STEP_START");
  assert.strictEqual(payload.events[1].type, "TOOL_EXECUTION");

  const toolEvent = payload.events[1] as any;
  assert.strictEqual(toolEvent.piiFilteredCount, 2);
  assert.strictEqual(toolEvent.success, true);

  assert.ok(payload.usage);
  assert.strictEqual(payload.usage.totalTokens, 70);
  assert.strictEqual(payload.usage.costUsd, 0.0001);

  const authHeader = (sentHeaders[0] as Record<string, string>)["Authorization"];
  assert.strictEqual(authHeader, "Bearer ag_live_secret_key_123");

  console.log("✅ PASS: Ingest payload matches DESIGN-005 format with auth and usage");
}

async function testAutoFlushOnMaxBatch(): Promise<void> {
  let postCount = 0;

  const mockFetch = async (): Promise<Response> => {
    postCount++;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const exporter = new HttpTelemetryExporter({
    apiKey: "ag_live_key",
    batchIntervalMs: 0,
    maxBatchSize: 3,
    fetchFn: mockFetch as any,
  });

  exporter.enqueue("run-batch", { type: "STEP_START", stepName: "step-1", timestamp: new Date().toISOString() });
  exporter.enqueue("run-batch", { type: "STEP_START", stepName: "step-2", timestamp: new Date().toISOString() });
  assert.strictEqual(postCount, 0, "Should not flush before maxBatchSize");

  exporter.enqueue("run-batch", { type: "STEP_START", stepName: "step-3", timestamp: new Date().toISOString() });
  
  // Wait a microtask tick for async fire-and-forget flush
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(postCount, 1, "Should auto-flush when maxBatchSize is reached");

  console.log("✅ PASS: Auto-flush triggers upon reaching maxBatchSize");
}

async function testNetworkResilience(): Promise<void> {
  let capturedError: Error | null = null;

  const mockFailingFetch = async (): Promise<Response> => {
    return new Response("Internal Server Error", { status: 500, statusText: "Server Error" });
  };

  const exporter = new HttpTelemetryExporter({
    apiKey: "ag_live_key",
    batchIntervalMs: 0,
    fetchFn: mockFailingFetch as any,
    onError: (err) => {
      capturedError = err;
    },
  });

  exporter.enqueue("run-fail", {
    type: "STEP_FAILED",
    stepName: "step-err",
    error: "Boom",
    timestamp: new Date().toISOString(),
  });

  // flush must not throw, but call onError
  await exporter.flush();

  assert.ok(capturedError, "onError callback should be called on HTTP failure");
  assert.match(capturedError.message, /500/);

  console.log("✅ PASS: Exporter handles network failures gracefully without throwing");
}

async function run(): Promise<void> {
  await testExporterPayloadFormat();
  await testAutoFlushOnMaxBatch();
  await testNetworkResilience();
  console.log("\n🎉 All HttpTelemetryExporter tests passed successfully!");
}

void run();
