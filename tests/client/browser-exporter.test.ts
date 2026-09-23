import assert from "node:assert";
import { BrowserTelemetryExporter } from "../../src/client/browser-exporter";
import { createAvantGateClient } from "../../src/client/client";
import { useAvantGateTelemetry } from "../../src/client/useAvantGateTelemetry";
import type { ClientTelemetryIngestPayload } from "../../src/client/types";

console.log("🌐 Testing avantgate/client BrowserTelemetryExporter & useAvantGateTelemetry Hook...");

async function testBrowserTelemetryExporterBasics(): Promise<void> {
  const sentRequests: { url: string; headers: Record<string, string>; body: ClientTelemetryIngestPayload; keepalive?: boolean }[] = [];

  const mockFetch = async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.body) {
      sentRequests.push({
        url: String(url),
        headers: init.headers as Record<string, string>,
        body: JSON.parse(init.body as string),
        keepalive: (init as any).keepalive,
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const exporter = new BrowserTelemetryExporter({
    publicKey: "gw_pub_test_12345",
    endpoint: "http://localhost:3000/api/v1/ingest/events",
    agentName: "prospect-qualifier",
    runId: "run-test-001",
    batchIntervalMs: 0, // Disable automatic timer
    fetchFn: mockFetch as any,
  });

  exporter.emit({
    type: "CLIENT_SECURITY_ALERT",
    alertType: "SUSPECTED_SECRET_INPUT",
    inputLength: 35,
    snippet: "sk-proj-abc...",
    timestamp: new Date().toISOString(),
  });

  exporter.emit({
    type: "CLIENT_DATA_RENDERED",
    toolId: "crm_lookup",
    renderedItemCount: 5,
    channel: "STREAM",
    timestamp: new Date().toISOString(),
  });

  // Manually flush
  await exporter.flush();

  assert.strictEqual(sentRequests.length, 1, "Expected exactly 1 HTTP request");
  const req = sentRequests[0];

  assert.strictEqual(req.url, "http://localhost:3000/api/v1/ingest/events");
  assert.strictEqual(req.headers["Authorization"], "Bearer gw_pub_test_12345");
  assert.strictEqual(req.headers["Content-Type"], "application/json");
  assert.strictEqual(req.keepalive, true, "Expected fetch with keepalive: true");

  assert.strictEqual(req.body.runId, "run-test-001");
  assert.strictEqual(req.body.agentName, "prospect-qualifier");
  assert.strictEqual(req.body.events.length, 2);
  assert.strictEqual(req.body.events[0].type, "CLIENT_SECURITY_ALERT");
  assert.strictEqual(req.body.events[1].type, "CLIENT_DATA_RENDERED");

  exporter.destroy();
  console.log("  ✅ Basics and payload schema validated.");
}

async function testAutoFlushOnMaxBatchSize(): Promise<void> {
  const sentRequests: ClientTelemetryIngestPayload[] = [];

  const mockFetch = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.body) {
      sentRequests.push(JSON.parse(init.body as string));
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const exporter = new BrowserTelemetryExporter({
    publicKey: "gw_pub_test",
    maxBatchSize: 3,
    batchIntervalMs: 0,
    fetchFn: mockFetch as any,
  });

  exporter.emit({ type: "USER_FEEDBACK", rating: "POSITIVE", timestamp: new Date().toISOString() });
  exporter.emit({ type: "USER_FEEDBACK", rating: "NEGATIVE", timestamp: new Date().toISOString() });
  assert.strictEqual(sentRequests.length, 0, "Should not flush before reaching maxBatchSize");

  // Third event triggers auto-flush
  exporter.emit({ type: "USER_FEEDBACK", rating: "POSITIVE", timestamp: new Date().toISOString() });
  // Wait a microtask for async flush
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.strictEqual(sentRequests.length, 1, "Expected auto-flush on reaching maxBatchSize = 3");
  assert.strictEqual(sentRequests[0].events.length, 3);

  exporter.destroy();
  console.log("  ✅ Auto-flush on maxBatchSize validated.");
}

async function testTimerAndLifecycleFlush(): Promise<void> {
  const sentRequests: ClientTelemetryIngestPayload[] = [];

  const mockFetch = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.body) {
      sentRequests.push(JSON.parse(init.body as string));
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const exporter = new BrowserTelemetryExporter({
    publicKey: "gw_pub_test",
    batchIntervalMs: 50,
    fetchFn: mockFetch as any,
  });

  exporter.emit({
    type: "CLIENT_SECURITY_ALERT",
    alertType: "POTENTIAL_PROMPT_INJECTION",
    inputLength: 120,
    timestamp: new Date().toISOString(),
  });

  // Wait for timer to tick
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.strictEqual(sentRequests.length, 1, "Expected timer auto-flush after 50ms");
  assert.strictEqual(sentRequests[0].events.length, 1);

  exporter.destroy();
  console.log("  ✅ Timer batch auto-flush validated.");
}

async function testErrorHandlingAndRetryBuffer(): Promise<void> {
  let failCount = 0;
  let reportedError: Error | null = null;

  const mockFetch = async (): Promise<Response> => {
    failCount++;
    return new Response("Service Unavailable", { status: 503, statusText: "Service Unavailable" });
  };

  const exporter = new BrowserTelemetryExporter({
    publicKey: "gw_pub_test",
    batchIntervalMs: 0,
    fetchFn: mockFetch as any,
    onError: (err) => {
      reportedError = err;
    },
  });

  exporter.emit({ type: "USER_FEEDBACK", rating: "NEGATIVE", timestamp: new Date().toISOString() });
  await exporter.flush();

  assert.strictEqual(failCount, 1);
  assert.ok(reportedError, "Expected onError callback to be invoked");
  assert.match(reportedError!.message, /503/);

  exporter.destroy();
  console.log("  ✅ Error handling and onError callback validated.");
}

async function testUseAvantGateTelemetryHook(): Promise<void> {
  const sentRequests: ClientTelemetryIngestPayload[] = [];

  const mockFetch = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.body) {
      sentRequests.push(JSON.parse(init.body as string));
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  // Simulating React Hooks Dispatcher in headless test environment
  const ReactInternals = (await import("react") as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const mockRef = { current: null as any };
  let cleanupFn: (() => void) | undefined;

  const previousDispatcher = ReactInternals.ReactCurrentDispatcher.current;
  ReactInternals.ReactCurrentDispatcher.current = {
    useRef: (initialValue: any) => {
      if (mockRef.current === null) {
        mockRef.current = initialValue;
      }
      return mockRef;
    },
    useEffect: (effect: () => void | (() => void)) => {
      cleanupFn = effect() || undefined;
    },
    useCallback: (fn: any) => fn,
    useMemo: (factory: any) => factory(),
  };

  try {
    const hook = useAvantGateTelemetry({
      publicKey: "gw_pub_react_test",
      runId: "run-react-42",
      agentName: "sales-assistant",
      batchIntervalMs: 0,
      fetchFn: mockFetch as any,
    });

  // 1. trackSecurityAlert
  hook.trackSecurityAlert("SUSPECTED_SECRET_INPUT", {
    inputLength: 45,
    snippet: "sk-ant-api03...",
  });

  // 2. trackClientDataRendered
  hook.trackClientDataRendered("prospect_search", {
    renderedItemCount: 12,
    channel: "SOCKET",
  });

  // 3. trackFeedback
  hook.trackFeedback({
    rating: "POSITIVE",
    tag: "HELPFUL",
    comment: "Excellent prospect recommendations!",
  });

  await hook.exporter?.flush();

  assert.strictEqual(sentRequests.length, 1);
  const payload = sentRequests[0];
  assert.strictEqual(payload.runId, "run-react-42");
  assert.strictEqual(payload.agentName, "sales-assistant");
  assert.strictEqual(payload.events.length, 3);

  const [alert, rendered, feedback] = payload.events;
  assert.strictEqual(alert.type, "CLIENT_SECURITY_ALERT");
  assert.strictEqual(rendered.type, "CLIENT_DATA_RENDERED");
  assert.strictEqual(feedback.type, "USER_FEEDBACK");

    hook.exporter?.destroy();
    console.log("  ✅ useAvantGateTelemetry React hook API validated.");
  } finally {
    if (cleanupFn) {
      cleanupFn();
    }
    ReactInternals.ReactCurrentDispatcher.current = previousDispatcher;
  }
}

async function testDynamicContextUpdate(): Promise<void> {
  const sentRequests: ClientTelemetryIngestPayload[] = [];

  const mockFetch = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.body) {
      sentRequests.push(JSON.parse(init.body as string));
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  const exporter = new BrowserTelemetryExporter({
    publicKey: "gw_pub_test",
    runId: "initial-run-1",
    agentName: "initial-agent",
    batchIntervalMs: 0,
    fetchFn: mockFetch as any,
  });

  assert.strictEqual(exporter.getRunId(), "initial-run-1");
  assert.strictEqual(exporter.getAgentName(), "initial-agent");

  // Dynamically switch runId and agentName
  exporter.updateContext({ runId: "updated-run-2", agentName: "updated-agent" });

  assert.strictEqual(exporter.getRunId(), "updated-run-2");
  assert.strictEqual(exporter.getAgentName(), "updated-agent");

  exporter.emit({ type: "USER_FEEDBACK", rating: "POSITIVE", timestamp: new Date().toISOString() });
  await exporter.flush();

  assert.strictEqual(sentRequests.length, 1);
  assert.strictEqual(sentRequests[0].runId, "updated-run-2");
  assert.strictEqual(sentRequests[0].agentName, "updated-agent");

  exporter.destroy();
  console.log("  ✅ Dynamic context update (runId / agentName) validated.");
}

async function testUniversalAvantGateClient(): Promise<void> {
  const sentRequests: ClientTelemetryIngestPayload[] = [];

  const mockFetch = async (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.body) {
      sentRequests.push(JSON.parse(init.body as string));
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  // Works in Vite (Vanilla JS, Vue, Svelte, etc.) - ZERO React dependency
  const client = createAvantGateClient({
    publicKey: "gw_pub_vite_test",
    runId: "run-vite-007",
    agentName: "prospect-qualifier",
    batchIntervalMs: 0,
    fetchFn: mockFetch as any,
  });

  client.trackSecurityAlert("POTENTIAL_PROMPT_INJECTION", {
    inputLength: 85,
    snippet: "Ignore instructions...",
  });

  client.trackClientDataRendered("prospect_table", {
    renderedItemCount: 10,
    channel: "HTTP",
  });

  client.trackFeedback({
    rating: "POSITIVE",
    tag: "HELPFUL",
    comment: "Fast response in Vite app!",
  });

  await client.flush();

  assert.strictEqual(sentRequests.length, 1);
  const payload = sentRequests[0];
  assert.strictEqual(payload.runId, "run-vite-007");
  assert.strictEqual(payload.agentName, "prospect-qualifier");
  assert.strictEqual(payload.events.length, 3);
  assert.strictEqual(payload.events[0].type, "CLIENT_SECURITY_ALERT");
  assert.strictEqual(payload.events[1].type, "CLIENT_DATA_RENDERED");
  assert.strictEqual(payload.events[2].type, "USER_FEEDBACK");

  client.destroy();
  console.log("  ✅ Universal framework-agnostic client (createAvantGateClient) validated.");
}

async function runAllClientTests(): Promise<void> {
  await testBrowserTelemetryExporterBasics();
  await testAutoFlushOnMaxBatchSize();
  await testTimerAndLifecycleFlush();
  await testErrorHandlingAndRetryBuffer();
  await testUseAvantGateTelemetryHook();
  await testDynamicContextUpdate();
  await testUniversalAvantGateClient();
  console.log("🎉 All avantgate/client tests passed successfully!\n");
}

runAllClientTests().catch((err) => {
  console.error("❌ Test failure:", err);
  process.exit(1);
});
