import assert from "node:assert";
import { createToolEnvelope, defineCanvas } from "../../src/ui";

console.log("🧪 Testing avantgate/ui: Envelope & defineCanvas...");

const testCreateToolEnvelope = (): void => {
  const envelope = createToolEnvelope({
    toolId: "search_crm_prospects",
    kind: "prospect_search",
    mergeStrategy: "REPLACE",
    dedupeKey: "id",
    uiIntent: {
      action: "HIGHLIGHT",
      targetId: "prospect_42",
      targetType: "prospect",
      metadata: { source: "test" },
    },
    data: {
      totalFound: 1,
      prospects: [{ id: "prospect_42", name: "Alice" }],
    },
  });

  assert.strictEqual(envelope.version, 1);
  assert.strictEqual(envelope.toolId, "search_crm_prospects");
  assert.strictEqual(envelope.kind, "prospect_search");
  assert.strictEqual(envelope.mergeStrategy, "REPLACE");
  assert.strictEqual(envelope.dedupeKey, "id");
  assert.strictEqual(Object.isFrozen(envelope), true);

  assert.deepStrictEqual(envelope.uiIntent, {
    action: "HIGHLIGHT",
    targetId: "prospect_42",
    targetType: "prospect",
    metadata: { source: "test" },
  });

  assert.deepStrictEqual(envelope.data, {
    totalFound: 1,
    prospects: [{ id: "prospect_42", name: "Alice" }],
  });

  console.log("  ✅ createToolEnvelope: Immutability and structure validated.");
};

const testDefineCanvasFactory = (): void => {
  interface TestCanvasMap {
    prospects: { count: number; items: Array<{ id: string }> };
    details: { id: string; notes: string };
  }

  const { createEnvelope, canvasReducer } = defineCanvas<TestCanvasMap>();

  assert.strictEqual(typeof createEnvelope, "function");
  assert.strictEqual(typeof canvasReducer, "function");

  const env = createEnvelope({
    toolId: "get_details",
    kind: "details",
    mergeStrategy: "REPLACE",
    data: { id: "d_1", notes: "test notes" },
  });

  assert.strictEqual(env.version, 1);
  assert.strictEqual(env.kind, "details");
  assert.deepStrictEqual(env.data, { id: "d_1", notes: "test notes" });

  console.log("  ✅ defineCanvas: Factory and typed envelope validated.");
};

const runAll = (): void => {
  testCreateToolEnvelope();
  testDefineCanvasFactory();
  console.log("🎉 All Envelope tests passed successfully!\n");
};

runAll();
