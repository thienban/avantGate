import assert from "node:assert";
import { createTaskRunner } from "../../src/client/task-runner";

console.log("🏃 Testing createTaskRunner (Universal Framework-Agnostic Port)...");

async function testRunnerInitialState(): Promise<void> {
  const runner = createTaskRunner({
    taskName: "enrich_lead",
    tenantId: "tenant_acme",
    handler: async () => ({ score: 90 }),
  });

  const state = runner.getState();
  assert.strictEqual(state.isRunning, false);
  assert.strictEqual(state.isFailed, false);
  assert.strictEqual(state.isSuccess, false);
  assert.strictEqual(state.attempts, 0);
  assert.strictEqual(state.data, null);
  assert.strictEqual(state.error, null);
  assert.strictEqual(state.runId, null);
  assert.strictEqual(state.parentRunId, null);
  assert.strictEqual(state.taskId, "enrich_lead");
  assert.strictEqual(state.tenantId, "tenant_acme");

  console.log("  ✅ Framework-agnostic initial state validated.");
}

async function testRunnerRunAndSubscription(): Promise<void> {
  const runner = createTaskRunner<string, { lead: string }>({
    taskName: "fetch_lead",
    handler: async (leadId: string) => {
      return { lead: leadId };
    },
  });

  const stateTransitions: boolean[] = [];
  const unsubscribe = runner.subscribe((state) => {
    stateTransitions.push(state.isRunning);
  });

  const result = await runner.run("lead_123");
  assert.deepStrictEqual(result, { lead: "lead_123" });

  const finalState = runner.getState();
  assert.strictEqual(finalState.isSuccess, true);
  assert.strictEqual(finalState.isRunning, false);
  assert.strictEqual(finalState.attempts, 1);
  assert.deepStrictEqual(finalState.data, { lead: "lead_123" });
  assert.ok(stateTransitions.length >= 2, "Listener received state updates");

  unsubscribe();
  console.log("  ✅ Run and reactive subscription transitions validated.");
}

async function testRunnerFailureRetryAndCausalLink(): Promise<void> {
  let attemptCount = 0;
  const calls: { attempt: number; parentRunId?: string }[] = [];

  const runner = createTaskRunner<{ email: string }, { ok: boolean }>({
    taskName: "sync_customer",
    tenantSalt: "secret_salt",
    maxManualRetries: 2,
    handler: async (_input, ctx) => {
      attemptCount++;
      calls.push({ attempt: ctx.attempt, parentRunId: ctx.parentRunId });
      if (attemptCount === 1) {
        throw new Error("Downstream CRM unreachable");
      }
      return { ok: true };
    },
  });

  // First execution fails
  await assert.rejects(
    async () => {
      await runner.run({ email: "user@corp.com" });
    },
    /Downstream CRM unreachable/
  );

  const failedState = runner.getState();
  assert.strictEqual(failedState.isFailed, true);
  assert.strictEqual(failedState.attempts, 1);
  const initialRunId = failedState.runId;
  assert.ok(initialRunId);

  // Manual retry succeeds and links parentRunId
  const retryResult = await runner.retry();
  assert.deepStrictEqual(retryResult, { ok: true });

  const recoveredState = runner.getState();
  assert.strictEqual(recoveredState.isSuccess, true);
  assert.strictEqual(recoveredState.attempts, 2);
  assert.strictEqual(recoveredState.parentRunId, initialRunId);
  assert.strictEqual(calls[1].parentRunId, initialRunId);

  console.log("  ✅ Failure and causal retry linking validated.");
}

async function testRunnerFinOpsCapAndConcurrency(): Promise<void> {
  let calls = 0;
  const runner = createTaskRunner({
    taskName: "execute_payment",
    maxManualRetries: 1,
    handler: async () => {
      calls++;
      throw new Error("Gateway timeout");
    },
  });

  await assert.rejects(async () => {
    await runner.run({});
  }, /Gateway timeout/);

  // Retry limit 1 reached on first failure attempt
  await assert.rejects(
    async () => {
      await runner.retry();
    },
    /Maximum manual retry limit \(1\) reached\. Please reset\./
  );

  // Reset clears state and allows re-run
  runner.reset();
  const resetState = runner.getState();
  assert.strictEqual(resetState.attempts, 0);
  assert.strictEqual(resetState.data, null);
  assert.strictEqual(resetState.error, null);

  console.log("  ✅ FinOps retry cap and reset lifecycle validated.");
}

async function runAllTests(): Promise<void> {
  await testRunnerInitialState();
  await testRunnerRunAndSubscription();
  await testRunnerFailureRetryAndCausalLink();
  await testRunnerFinOpsCapAndConcurrency();
  console.log("🎉 All createTaskRunner tests passed successfully!\n");
}

runAllTests().catch((err) => {
  console.error("❌ Test error:", err);
  process.exit(1);
});
