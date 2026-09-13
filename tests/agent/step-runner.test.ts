import {
  createStepRunner,
  StepSuspendedError,
  StepExecutionError,
  MemoryStorageAdapter,
} from "../../src/agent";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runStepRunnerTests() {
  console.log("⚡ Testing avantgate/agent StepRunner Engine...\n");

  const storage = new MemoryStorageAdapter();
  const runner = createStepRunner({
    workflowId: "wf-order-101",
    storage,
  });

  // Test 1: Step Run execution and caching (Idempotence)
  let executionCount = 0;
  const result1 = await runner.run("calculate-tax", async () => {
    executionCount++;
    return { tax: 42.5, currency: "EUR" };
  });

  assert(result1.tax === 42.5, "Step returns calculated value on initial execution");
  assert(executionCount === 1, "Execute callback was called once");

  // Re-run same stepId
  const result2 = await runner.run("calculate-tax", async () => {
    executionCount++;
    return { tax: 999, currency: "EUR" };
  });

  assert(result2.tax === 42.5, "Step returns cached value on subsequent run");
  assert(executionCount === 1, "Execute callback was not re-invoked (idempotent)");

  // Test 2: Error handling in Step Run
  let caughtError: unknown = null;
  try {
    await runner.run("fail-step", async () => {
      throw new Error("Database timeout");
    });
  } catch (err) {
    caughtError = err;
  }

  assert(caughtError instanceof StepExecutionError, "Step failure raises StepExecutionError");
  const failedRecord = await storage.getStep("wf-order-101", "fail-step");
  assert(failedRecord?.status === "FAILED", "Failed step status is set to FAILED in storage");
  assert(failedRecord?.error === "Database timeout", "Error message recorded in storage");

  // Test 3: Human-in-the-Loop suspension
  let suspendedError: unknown = null;
  try {
    await runner.waitForApproval("financial-wire", {
      metadata: { amount: 50000, recipient: "ACME Corp" },
    });
  } catch (err) {
    suspendedError = err;
  }

  assert(suspendedError instanceof StepSuspendedError, "waitForApproval throws StepSuspendedError");
  const approvalRecord = await storage.getStep("wf-order-101", "financial-wire");
  assert(approvalRecord?.status === "WAITING_APPROVAL", "Step marked as WAITING_APPROVAL in storage");

  // Test 4: Approval and resume
  await runner.approveStep("financial-wire", {
    authorizedBy: "finance_director",
    token: "AUTH-789",
  });

  const resumedResult = await runner.waitForApproval<{ authorizedBy: string }>("financial-wire");
  assert(resumedResult.authorizedBy === "finance_director", "Resumed approval returns stored decision");

  // Test 5: Rejection
  await runner.rejectStep("financial-wire-2", "Budget exceeded");
  const rejectedRecord = await storage.getStep("wf-order-101", "financial-wire-2");
  assert(rejectedRecord?.status === "FAILED", "Rejected step is marked FAILED");
  assert(rejectedRecord?.error === "Budget exceeded", "Rejection reason recorded");

  console.log("\n🎉 All StepRunner tests passed successfully!");
}

runStepRunnerTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
