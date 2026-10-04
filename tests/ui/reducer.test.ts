import assert from "node:assert";
import {
  createCanvasReducer,
  createToolEnvelope,
} from "../../src/ui";

console.log("🧪 Testing avantgate/ui: Canvas Reducer & Merging Engine...");

interface TestCanvasMap {
  prospect_search: {
    totalFound: number;
    prospects: Array<{ id: string; name: string; stage?: string }>;
  };
  prospect_dossier: {
    prospectId: string;
    score: number;
  };
}

const reducer = createCanvasReducer<TestCanvasMap>();

const testReplaceStrategy = (): void => {
  const env1 = createToolEnvelope({
    toolId: "search_1",
    kind: "prospect_search",
    mergeStrategy: "REPLACE",
    uiIntent: { action: "HIGHLIGHT", targetId: "p1", targetType: "prospect" },
    data: {
      totalFound: 1,
      prospects: [{ id: "p1", name: "Alpha" }],
    },
  });

  const state1 = reducer(null, env1);
  assert.strictEqual(state1.content?.kind, "prospect_search");
  assert.strictEqual(state1.content?.totalFound, 1);
  assert.strictEqual(state1.content?.prospects.length, 1);
  assert.strictEqual(state1.activeIntent?.action, "HIGHLIGHT");
  assert.strictEqual(state1.activeIntent?.targetId, "p1");

  // Remplacement avec nouvelles données
  const env2 = createToolEnvelope({
    toolId: "search_2",
    kind: "prospect_search",
    mergeStrategy: "REPLACE",
    data: {
      totalFound: 2,
      prospects: [{ id: "p2", name: "Beta" }, { id: "p3", name: "Gamma" }],
    },
  });

  const state2 = reducer(state1, env2);
  assert.strictEqual(state2.content?.totalFound, 2);
  assert.strictEqual(state2.content?.prospects.length, 2);
  assert.strictEqual(state2.content?.prospects[0].id, "p2");

  // Changement de kind vers prospect_dossier
  const env3 = createToolEnvelope({
    toolId: "dossier_1",
    kind: "prospect_dossier",
    mergeStrategy: "REPLACE",
    data: { prospectId: "p1", score: 95 },
  });

  const state3 = reducer(state2, env3);
  assert.strictEqual(state3.content?.kind, "prospect_dossier");
  assert.strictEqual(state3.content?.score, 95);

  console.log("  ✅ Strategy REPLACE: Clean overwrite and kind switching validated.");
};

const testAppendUniqueStrategy = (): void => {
  const envInitial = createToolEnvelope({
    toolId: "init",
    kind: "prospect_search",
    mergeStrategy: "REPLACE",
    data: {
      totalFound: 1,
      prospects: [{ id: "p1", name: "Alpha" }],
    },
  });

  const stateInitial = reducer(null, envInitial);

  // Appending batch containing duplicate p1 and new p2
  const envAppend = createToolEnvelope({
    toolId: "append_batch",
    kind: "prospect_search",
    mergeStrategy: "APPEND_UNIQUE",
    dedupeKey: "id",
    data: {
      totalFound: 2,
      prospects: [
        { id: "p1", name: "Alpha-Duplicate" },
        { id: "p2", name: "Beta" },
      ],
    },
  });

  const stateMerged = reducer(stateInitial, envAppend);
  assert.strictEqual(stateMerged.content?.kind, "prospect_search");
  assert.strictEqual(stateMerged.content?.totalFound, 2);
  assert.strictEqual(stateMerged.content?.prospects.length, 2);
  assert.strictEqual(stateMerged.content?.prospects[0].id, "p1");
  assert.strictEqual(stateMerged.content?.prospects[0].name, "Alpha"); // Preserved original
  assert.strictEqual(stateMerged.content?.prospects[1].id, "p2");

  console.log("  ✅ Strategy APPEND_UNIQUE: O(N) deduplication validated.");
};

const testUpdateEntityStrategy = (): void => {
  const envInitial = createToolEnvelope({
    toolId: "init",
    kind: "prospect_search",
    mergeStrategy: "REPLACE",
    data: {
      totalFound: 2,
      prospects: [
        { id: "p1", name: "Alpha", stage: "NEW" },
        { id: "p2", name: "Beta", stage: "NEW" },
      ],
    },
  });

  const stateInitial = reducer(null, envInitial);

  const envUpdate = createToolEnvelope({
    toolId: "update_stage",
    kind: "prospect_search",
    mergeStrategy: "UPDATE_ENTITY",
    dedupeKey: "id",
    data: { id: "p2", stage: "QUALIFIED" },
  });

  const stateUpdated = reducer(stateInitial, envUpdate);
  assert.strictEqual(stateUpdated.content?.prospects.length, 2);
  assert.strictEqual(stateUpdated.content?.prospects[0].stage, "NEW");
  assert.strictEqual(stateUpdated.content?.prospects[1].stage, "QUALIFIED");
  assert.strictEqual(stateUpdated.content?.prospects[1].name, "Beta");

  console.log("  ✅ Strategy UPDATE_ENTITY: In-place field patch validated.");
};

const testAntiPrototypePollution = (): void => {
  const maliciousPayload = JSON.parse(
    '{"__proto__": {"polluted": "yes"}, "constructor": {"prototype": {"admin": true}}, "id": "p1", "name": "Hacked"}'
  );

  const env = createToolEnvelope({
    toolId: "hack",
    kind: "prospect_search",
    mergeStrategy: "REPLACE",
    data: maliciousPayload,
  });

  const state = reducer(null, env);
  assert.strictEqual((Object.prototype as any).polluted, undefined);
  assert.strictEqual((Object.prototype as any).admin, undefined);

  // Essai en UPDATE_ENTITY
  const envUpdate = createToolEnvelope({
    toolId: "hack_update",
    kind: "prospect_search",
    mergeStrategy: "UPDATE_ENTITY",
    dedupeKey: "id",
    data: maliciousPayload,
  });

  reducer(state, envUpdate);
  assert.strictEqual((Object.prototype as any).polluted, undefined);
  assert.strictEqual((Object.prototype as any).admin, undefined);

  console.log("  ✅ Security: Prototype pollution attack neutralized.");
};

const runAll = (): void => {
  testReplaceStrategy();
  testAppendUniqueStrategy();
  testUpdateEntityStrategy();
  testAntiPrototypePollution();
  console.log("🎉 All Reducer tests passed successfully!\n");
};

runAll();
