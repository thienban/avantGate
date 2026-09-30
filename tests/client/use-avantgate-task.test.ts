import assert from "node:assert";
import { useTask } from "../../src/client/useTask";

console.log("🧪 Testing useAvantGateTask React hook (Client-Driven In-Context Replay)...");

function setupReactDispatcher() {
  const ReactInternals = (require("react") as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
  const previousDispatcher = ReactInternals.ReactCurrentDispatcher.current;

  const stateSlots: any[] = [];
  let stateIndex = 0;
  const refSlots: any[] = [];
  let refIndex = 0;

  const effectSlots: any[] = [];
  let effectIndex = 0;
  const cleanups: (() => void)[] = [];

  const mockDispatcher = {
    useState: (initialValue: any) => {
      const currentIndex = stateIndex++;
      if (stateSlots[currentIndex] === undefined) {
        stateSlots[currentIndex] = typeof initialValue === "function" ? initialValue() : initialValue;
      }
      const setState = (action: any) => {
        stateSlots[currentIndex] = typeof action === "function" ? action(stateSlots[currentIndex]) : action;
      };
      return [stateSlots[currentIndex], setState];
    },
    useRef: (initialValue: any) => {
      const currentIndex = refIndex++;
      if (refSlots[currentIndex] === undefined) {
        refSlots[currentIndex] = { current: initialValue };
      }
      return refSlots[currentIndex];
    },
    useCallback: (fn: any) => fn,
    useMemo: (factory: any) => factory(),
    useEffect: (effect: any, deps?: any[]) => {
      const currentIndex = effectIndex++;
      const prevDeps = effectSlots[currentIndex];
      const shouldRun = !prevDeps || !deps || deps.some((d: any, i: number) => d !== prevDeps[i]);
      if (shouldRun) {
        effectSlots[currentIndex] = deps;
        const cleanup = effect();
        if (typeof cleanup === "function") {
          cleanups.push(cleanup);
        }
      }
    },
  };

  ReactInternals.ReactCurrentDispatcher.current = mockDispatcher;

  return {
    restore: () => {
      cleanups.forEach((cleanup) => cleanup());
      ReactInternals.ReactCurrentDispatcher.current = previousDispatcher;
    },
    resetHookIndices: () => {
      stateIndex = 0;
      refIndex = 0;
      effectIndex = 0;
    },
  };
}

async function testTaskInitialState(): Promise<void> {
  const { restore, resetHookIndices } = setupReactDispatcher();

  try {
    resetHookIndices();
    const task = useTask({
      taskName: "enrich_lead",
      handler: async () => ({ score: 95 }),
    });

    assert.strictEqual(task.isRunning, false);
    assert.strictEqual(task.isFailed, false);
    assert.strictEqual(task.isSuccess, false);
    assert.strictEqual(task.attempts, 0);
    assert.strictEqual(task.data, null);
    assert.strictEqual(task.error, null);
    assert.strictEqual(task.runId, null);
    assert.strictEqual(task.parentRunId, null);

    console.log("  ✅ Initial state correctly initialized.");
  } finally {
    restore();
  }
}

async function testTaskRunSuccess(): Promise<void> {
  const { restore, resetHookIndices } = setupReactDispatcher();

  try {
    resetHookIndices();
    const calls: { input: string; parentRunId?: string; attempt: number }[] = [];

    const task = useTask({
      taskName: "analyze_company",
      handler: async (input: string, ctx) => {
        calls.push({ input, ...ctx });
        return { name: input, employees: 50 };
      },
    });

    const result = await task.run("Acme Corp");

    assert.deepStrictEqual(result, { name: "Acme Corp", employees: 50 });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].input, "Acme Corp");
    assert.strictEqual(calls[0].attempt, 1);
    assert.strictEqual(calls[0].parentRunId, undefined);

    resetHookIndices();
    const updatedTask = useTask({
      taskName: "analyze_company",
      handler: async () => ({ name: "", employees: 0 }),
    });

    assert.strictEqual(updatedTask.isSuccess, true);
    assert.strictEqual(updatedTask.isRunning, false);
    assert.strictEqual(updatedTask.isFailed, false);
    assert.strictEqual(updatedTask.attempts, 1);
    assert.ok(updatedTask.runId?.startsWith("run_analyze_company_"));

    console.log("  ✅ Successful task run validated.");
  } finally {
    restore();
  }
}

async function testTaskFailureAndRetry(): Promise<void> {
  const { restore, resetHookIndices } = setupReactDispatcher();

  try {
    resetHookIndices();
    let attemptCount = 0;
    const retryCalls: { parentRunId?: string; attempt: number }[] = [];

    const outreachHandler = async (input: { email: string }, ctx: { parentRunId?: string; attempt: number }) => {
      attemptCount++;
      retryCalls.push(ctx);
      if (attemptCount === 1) {
        throw new Error("HTTP 429 Rate Limit Exceeded");
      }
      return { delivered: true, recipient: input.email };
    };

    const task = useTask({
      taskName: "send_outreach",
      handler: outreachHandler,
    });

    // 1. First run fails
    await assert.rejects(
      async () => {
        await task.run({ email: "contact@acme.com" });
      },
      /HTTP 429 Rate Limit Exceeded/
    );

    assert.strictEqual(retryCalls.length, 1);
    assert.strictEqual(retryCalls[0].attempt, 1);
    assert.strictEqual(retryCalls[0].parentRunId, undefined);

    resetHookIndices();
    let currentTask = useTask({
      taskName: "send_outreach",
      handler: outreachHandler,
    });

    assert.strictEqual(currentTask.isFailed, true);
    assert.strictEqual(currentTask.isSuccess, false);
    assert.strictEqual(currentTask.attempts, 1);
    const initialRunId = currentTask.runId;
    assert.ok(initialRunId);

    // 2. Retry succeeds and links parentRunId
    const retryResult = await currentTask.retry();

    assert.deepStrictEqual(retryResult, { delivered: true, recipient: "contact@acme.com" });
    assert.strictEqual(retryCalls.length, 2);
    assert.strictEqual(retryCalls[1].attempt, 2);
    assert.strictEqual(retryCalls[1].parentRunId, initialRunId);

    resetHookIndices();
    currentTask = useTask({
      taskName: "send_outreach",
      handler: outreachHandler,
    });

    assert.strictEqual(currentTask.isSuccess, true);
    assert.strictEqual(currentTask.isFailed, false);
    assert.strictEqual(currentTask.attempts, 2);
    assert.strictEqual(currentTask.parentRunId, initialRunId);
    assert.notStrictEqual(currentTask.runId, initialRunId);

    console.log("  ✅ Failure and In-Context Retry linking parentRunId validated.");
  } finally {
    restore();
  }
}

async function testSecurityHardening(): Promise<void> {
  const { restore, resetHookIndices } = setupReactDispatcher();

  try {
    resetHookIndices();

    // 1. Test deriveOpaqueTaskId
    const { deriveOpaqueTaskId } = await import("../../src/client/useTask");
    const rawName = "wire_transfer";
    const plainId = deriveOpaqueTaskId(rawName);
    assert.strictEqual(plainId, "wire_transfer", "Without salt, deriveOpaqueTaskId returns raw taskName");

    const opaqueId1 = deriveOpaqueTaskId(rawName, "tenant_acme_salt_secret");
    const opaqueId2 = deriveOpaqueTaskId(rawName, "tenant_acme_salt_secret");
    assert.ok(opaqueId1.startsWith("tsk_"), "Opaque task ID starts with tsk_");
    assert.strictEqual(opaqueId1, opaqueId2, "HMAC derivation is strictly deterministic");
    assert.notStrictEqual(opaqueId1, rawName, "Business intent is masked");

    // 2. Test maxManualRetries limit and concurrency locking
    let attempts = 0;
    const task = useTask({
      taskName: "wire_transfer",
      tenantId: "tenant_acme",
      tenantSalt: "tenant_acme_salt_secret",
      maxManualRetries: 2,
      handler: async (_input: any, ctx) => {
        attempts++;
        assert.strictEqual(ctx.taskId, opaqueId1, "Handler receives derived opaque taskId");
        assert.strictEqual(ctx.tenantId, "tenant_acme", "Handler receives verified tenantId");
        throw new Error("Temporary service outage");
      },
    });

    assert.strictEqual(task.taskId, opaqueId1);
    assert.strictEqual(task.tenantId, "tenant_acme");

    // First run fails (attempt 1)
    await assert.rejects(async () => {
      await task.run({ amount: 100 });
    }, /Temporary service outage/);

    // Manual retry 1 fails (attempt 2, reaching maxManualRetries = 2)
    resetHookIndices();
    const taskAttempt1 = useTask({
      taskName: "wire_transfer",
      tenantId: "tenant_acme",
      tenantSalt: "tenant_acme_salt_secret",
      maxManualRetries: 2,
      handler: async () => {
        throw new Error("Temporary service outage");
      },
    });

    await assert.rejects(async () => {
      await taskAttempt1.retry();
    }, /Temporary service outage/);

    // Manual retry 2 should be rejected by FinOps cap (attemptCountRef >= 2)
    resetHookIndices();
    const taskAttempt2 = useTask({
      taskName: "wire_transfer",
      tenantId: "tenant_acme",
      tenantSalt: "tenant_acme_salt_secret",
      maxManualRetries: 2,
      handler: async () => ({ ok: true }),
    });

    await assert.rejects(
      async () => {
        await taskAttempt2.retry();
      },
      /Maximum manual retry limit \(2\) reached\. Please reset\./
    );

    console.log("  ✅ Security hardening: Opaque task ID derivation, tenant binding & FinOps retry limit validated.");
  } finally {
    restore();
  }
}

async function runAllTests(): Promise<void> {
  await testTaskInitialState();
  await testTaskRunSuccess();
  await testTaskFailureAndRetry();
  await testSecurityHardening();
  console.log("🎉 All useAvantGateTask tests passed successfully!\n");
}

runAllTests().catch((err) => {
  console.error("❌ Test error:", err);
  process.exit(1);
});
