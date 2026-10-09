import assert from "node:assert";
import {
  withToolResilience,
  getToolExecutionRecord,
} from "../../src/agent/tool-resilience";
import { AmbiguousToolExecutionError, StepSuspendedError } from "../../src/agent/errors";
import { MemoryStorageAdapter } from "../../src/agent/adapters/memory-adapter";
import { createIsolatedTool } from "../../src/agent/isolated-tool";

console.log("🛡️ Testing avantgate/agent Tool Resilience & Ambiguous Claim (FEAT-031)...");

const testNominalFirstCall = async (): Promise<void> => {
  const storage = new MemoryStorageAdapter();
  let calls = 0;
  const res = await withToolResilience({
    toolCallId: "call_nom_1",
    storage,
    impact: "MUTATIVE",
    action: async () => {
      calls++;
      return { refundId: "ref_100", status: "succeeded" };
    },
  });
  assert.strictEqual(calls, 1);
  assert.strictEqual(res.isCached, false);
  assert.strictEqual(res.status, "COMPLETED");
  assert.deepStrictEqual(res.result, { refundId: "ref_100", status: "succeeded" });
  const record = await getToolExecutionRecord(storage, "call_nom_1");
  assert.strictEqual(record?.status, "COMPLETED");
};

const testCachedShortCircuit = async (): Promise<void> => {
  const storage = new MemoryStorageAdapter();
  let calls = 0;
  const action = async () => {
    calls++;
    return { balance: 500 };
  };
  const first = await withToolResilience({ toolCallId: "call_cached_1", storage, impact: "MUTATIVE", action });
  const second = await withToolResilience({ toolCallId: "call_cached_1", storage, impact: "MUTATIVE", action });
  assert.strictEqual(calls, 1);
  assert.strictEqual(first.isCached, false);
  assert.strictEqual(second.isCached, true);
  assert.strictEqual(second.status, "COMPLETED");
  assert.deepStrictEqual(second.result, { balance: 500 });
};

const testTimeoutTransitionsToUnconfirmed = async (): Promise<void> => {
  const storage = new MemoryStorageAdapter();
  await assert.rejects(async () => {
    await withToolResilience({
      toolCallId: "call_timeout_1",
      storage,
      impact: "MUTATIVE",
      timeoutMs: 30,
      action: async () => new Promise((_, reject) => setTimeout(() => reject(new Error("socket hang up")), 10)),
    });
  });
  const record = await getToolExecutionRecord(storage, "call_timeout_1");
  assert.strictEqual(record?.status, "UNCONFIRMED_TIMEOUT");
};

const testMutativeBlockedWithoutReconciliation = async (): Promise<void> => {
  const storage = new MemoryStorageAdapter();
  try {
    await withToolResilience({
      toolCallId: "call_block_1",
      storage,
      impact: "MUTATIVE",
      action: async () => {
        throw new Error("ETIMEDOUT: Connection dropped");
      },
    });
  } catch {}
  let reexecuted = false;
  await assert.rejects(
    async () => {
      await withToolResilience({
        toolCallId: "call_block_1",
        storage,
        impact: "MUTATIVE",
        action: async () => {
          reexecuted = true;
          return { ok: true };
        },
      });
    },
    (err: unknown) => err instanceof AmbiguousToolExecutionError && (err as AmbiguousToolExecutionError).toolCallId === "call_block_1"
  );
  assert.strictEqual(reexecuted, false);
};

const testSuccessfulReconciliation = async (): Promise<void> => {
  const storage = new MemoryStorageAdapter();
  try {
    await withToolResilience({
      toolCallId: "call_rec_1",
      storage,
      impact: "MUTATIVE",
      action: async () => {
        throw new Error("socket hang up");
      },
    });
  } catch {}
  let writeCalls = 0;
  const outcome = await withToolResilience({
    toolCallId: "call_rec_1",
    storage,
    impact: "MUTATIVE",
    args: { chargeId: "ch_999" },
    action: async () => {
      writeCalls++;
      return { created: true };
    },
    onAmbiguousRetry: async ({ toolCallId, args }) => {
      assert.strictEqual(toolCallId, "call_rec_1");
      assert.deepStrictEqual(args, { chargeId: "ch_999" });
      return { reconciled: true, result: { chargeId: "ch_999", recovered: true } };
    },
  });
  assert.strictEqual(writeCalls, 0);
  assert.strictEqual(outcome.isCached, true);
  assert.strictEqual(outcome.status, "COMPLETED");
  assert.deepStrictEqual(outcome.result, { chargeId: "ch_999", recovered: true });
  const record = await getToolExecutionRecord(storage, "call_rec_1");
  assert.strictEqual(record?.status, "COMPLETED");
};

const testSuspensionHITLWhenReconciliationFails = async (): Promise<void> => {
  const storage = new MemoryStorageAdapter();
  try {
    await withToolResilience({
      toolCallId: "call_suspend_1",
      storage,
      impact: "MUTATIVE",
      action: async () => {
        throw new Error("network error");
      },
    });
  } catch {}
  await assert.rejects(
    async () => {
      await withToolResilience({
        toolCallId: "call_suspend_1",
        storage,
        impact: "MUTATIVE",
        suspendOnAmbiguous: true,
        action: async () => ({ ok: true }),
        onAmbiguousRetry: async () => ({ reconciled: false }),
      });
    },
    (err: unknown) => err instanceof StepSuspendedError && (err as StepSuspendedError).stepId === "call_suspend_1"
  );
};

const testReadOnlyAllowsReExecution = async (): Promise<void> => {
  const storage = new MemoryStorageAdapter();
  try {
    await withToolResilience({
      toolCallId: "call_ro_1",
      storage,
      impact: "READ_ONLY",
      action: async () => {
        throw new Error("fetch failed");
      },
    });
  } catch {}
  let reExecCalls = 0;
  const res = await withToolResilience({
    toolCallId: "call_ro_1",
    storage,
    impact: "READ_ONLY",
    action: async () => {
      reExecCalls++;
      return { rows: [1, 2, 3] };
    },
  });
  assert.strictEqual(reExecCalls, 1);
  assert.strictEqual(res.status, "COMPLETED");
  assert.deepStrictEqual(res.result, { rows: [1, 2, 3] });
};

const testDeterministic4xxSetsFailed = async (): Promise<void> => {
  const storage = new MemoryStorageAdapter();
  const badReqError = Object.assign(new Error("Bad Request: invalid payload"), { status: 400 });
  await assert.rejects(async () => {
    await withToolResilience({
      toolCallId: "call_4xx_1",
      storage,
      impact: "MUTATIVE",
      action: async () => {
        throw badReqError;
      },
    });
  });
  const record = await getToolExecutionRecord(storage, "call_4xx_1");
  assert.strictEqual(record?.status, "FAILED");
};

const testCreateIsolatedToolResilienceIntegration = async (): Promise<void> => {
  const storage = new MemoryStorageAdapter();
  let executedTimes = 0;
  const tool = createIsolatedTool({
    name: "refund_order",
    description: "Refund an order",
    parameters: {},
    impact: "MUTATIVE",
    resilience: {
      timeoutMs: 1000,
      onAmbiguousRetry: async ({ toolCallId }) => ({ reconciled: true, result: { toolCallId, status: "reconciled" } }),
    },
    execute: async (args, ctx) => {
      executedTimes++;
      return { toolCallId: ctx?.toolCallId, idempotencyKey: ctx?.idempotencyKey, success: true };
    },
  });
  const first = await tool.execute({}, { storage, toolCallId: "call_iso_1" });
  assert.strictEqual(executedTimes, 1);
  assert.strictEqual(first.success, true);
  const second = await tool.execute({}, { storage, toolCallId: "call_iso_1" });
  assert.strictEqual(executedTimes, 1);
  assert.strictEqual(second.success, true);
};

const runAllTests = async (): Promise<void> => {
  await testNominalFirstCall();
  await testCachedShortCircuit();
  await testTimeoutTransitionsToUnconfirmed();
  await testMutativeBlockedWithoutReconciliation();
  await testSuccessfulReconciliation();
  await testSuspensionHITLWhenReconciliationFails();
  await testReadOnlyAllowsReExecution();
  await testDeterministic4xxSetsFailed();
  await testCreateIsolatedToolResilienceIntegration();
  console.log("✅ All FEAT-031 Tool Resilience tests passed successfully!");
};

runAllTests().catch((err) => {
  console.error("❌ Test failure:", err);
  process.exit(1);
});
