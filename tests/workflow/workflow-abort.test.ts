import { z } from "zod";
import {
  defineWorkflow,
  WorkflowAbortSignal,
  isWorkflowAbortSignal,
} from "../../src/workflow";
import { MemoryStorageAdapter } from "../../src/agent";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runWorkflowAbortTests() {
  console.log("🛑 Testing avantgate/workflow Graceful Abort & Sentinel Pattern (FEAT-015)...\n");

  // =========================================================================
  // 1. Short-Circuiting & Step Skipping
  // =========================================================================
  const executedSteps: string[] = [];

  const abortWorkflow = defineWorkflow({
    id: "prospect_followup_pipeline",
    name: "Pipeline de relance prospect",
    inputSchema: z.object({
      prospectId: z.string(),
      shouldAbort: z.boolean(),
    }),
    steps: [
      {
        id: "step_check_prospect",
        name: "Vérification du prospect",
        execute: async (input, ctx) => {
          executedSteps.push("step_check_prospect");
          if (input.shouldAbort) {
            return ctx.abort("PROSPECT_NOT_FOUND", {
              prospectId: input.prospectId,
              suggestedAction: "create_lead",
            });
          }
          return { found: true };
        },
      },
      {
        id: "step_send_email",
        name: "Envoi de l'email",
        execute: async () => {
          executedSteps.push("step_send_email");
          return { emailSent: true };
        },
      },
      {
        id: "step_book_calendar",
        name: "Réservation calendrier",
        execute: async () => {
          executedSteps.push("step_book_calendar");
          return { booked: true };
        },
      },
    ],
  });

  const abortResult = await abortWorkflow.execute({
    prospectId: "lead_404",
    shouldAbort: true,
  });

  assert(abortResult.status === "ABORTED", "Status is ABORTED when ctx.abort() is called");
  assert(abortResult.abortReason === "PROSPECT_NOT_FOUND", "abortReason is captured correctly");
  assert(
    (abortResult.abortPayload as any)?.suggestedAction === "create_lead",
    "abortPayload is passed in execution result"
  );
  assert(
    executedSteps.length === 1 && executedSteps[0] === "step_check_prospect",
    "Subsequent steps (email, calendar) were strictly skipped"
  );
  assert(
    (abortResult.output as any)?.suggestedAction === "create_lead",
    "Final output automatically adopted the abort payload"
  );

  // =========================================================================
  // 2. Sentinel Pattern: Immediate Halt Even If Return is Omitted
  // =========================================================================
  let dangerousCodeExecuted = false;

  const sentinelWorkflow = defineWorkflow({
    id: "sentinel_test_pipeline",
    name: "Test du pattern Sentinel throw",
    inputSchema: z.object({ shouldHalt: z.boolean() }),
    steps: [
      {
        id: "step_with_sentinel",
        name: "Étape avec oubli volontaire de return",
        execute: async (input, ctx) => {
          if (input.shouldHalt) {
            // NOTE: Voluntary omission of 'return' !
            ctx.abort("HALTED_BY_SENTINEL", { halted: true });
          }
          // The code below must NEVER be reached!
          dangerousCodeExecuted = true;
          return { safe: false };
        },
      },
    ],
  });

  const sentinelResult = await sentinelWorkflow.execute({ shouldHalt: true });

  assert(sentinelResult.status === "ABORTED", "Workflow aborted via Sentinel throw without return");
  assert(
    dangerousCodeExecuted === false,
    "Code below ctx.abort() inside the step function was completely halted"
  );

  // =========================================================================
  // 3. Zero Saga Compensation (Preceding Steps Remain Intact)
  // =========================================================================
  let step1Compensated = false;
  const auditLogs: string[] = [];

  const nonDestructiveAbortWorkflow = defineWorkflow({
    id: "credit_assessment_pipeline",
    name: "Pipeline d'octroi de crédit",
    inputSchema: z.object({ customerId: z.string(), score: z.number() }),
    steps: [
      {
        id: "step_log_audit",
        name: "Enregistrement de l'audit réglementaire",
        execute: async (input) => {
          auditLogs.push(`audit_created_for_${input.customerId}`);
          return { auditLogged: true };
        },
        compensate: async () => {
          // This should NEVER be called on business abort!
          step1Compensated = true;
        },
      },
      {
        id: "step_verify_credit_score",
        name: "Vérification du score",
        execute: async (input, ctx) => {
          if (input.score < 600) {
            return ctx.abort("INSUFFICIENT_CREDIT_SCORE", {
              score: input.score,
              minRequired: 600,
            });
          }
          return { approved: true };
        },
      },
      {
        id: "step_issue_loan",
        name: "Émission du prêt",
        execute: async () => ({ loanIssued: true }),
      },
    ],
  });

  const creditResult = await nonDestructiveAbortWorkflow.execute({
    customerId: "cust_123",
    score: 520,
  });

  assert(creditResult.status === "ABORTED", "Credit workflow aborted cleanly");
  assert(
    step1Compensated === false,
    "ZERO SAGA ROLLBACK: Step 1 compensate handler was NOT called"
  );
  assert(
    auditLogs.length === 1 && auditLogs[0] === "audit_created_for_cust_123",
    "Preceding Step 1 audit data remains permanently intact"
  );

  // =========================================================================
  // 4. Persistence in StepStorageAdapter
  // =========================================================================
  const storage = new MemoryStorageAdapter();

  const storedWorkflow = defineWorkflow({
    id: "stored_abort_pipeline",
    name: "Pipeline stocké avec abort",
    inputSchema: z.object({ id: z.string() }),
    steps: [
      {
        id: "step_abort_persisted",
        name: "Étape persistée avec abort",
        execute: async (_input, ctx) => {
          return ctx.abort("STORAGE_ABORT_TEST", { test: true });
        },
      },
    ],
  });

  await storedWorkflow.execute({ id: "item_1" }, { storage });

  const persistedStep = await storage.getStep("stored_abort_pipeline", "step_abort_persisted");
  assert(persistedStep !== null, "Step state persisted in storage adapter");
  assert(persistedStep?.status === "ABORTED", "Storage record status is ABORTED");
  assert(
    (persistedStep?.metadata as any)?.abortReason === "STORAGE_ABORT_TEST",
    "Storage record metadata contains abortReason"
  );

  // =========================================================================
  // 5. Agent Tool Conversion (asTool())
  // =========================================================================
  const tool = abortWorkflow.asTool();

  // In AI agent tool calls, aborted workflows should return output cleanly without throwing
  const toolOutput = await tool.execute({
    prospectId: "lead_999",
    shouldAbort: true,
  });

  assert(toolOutput !== undefined, "Tool execution completed without throwing an error");
  assert(
    (toolOutput as any)?.suggestedAction === "create_lead",
    "Tool delivered structured abort payload to LLM context"
  );

  // Nominal path through tool still works
  const nominalOutput = await tool.execute({
    prospectId: "lead_valid",
    shouldAbort: false,
  });
  assert(nominalOutput !== undefined, "Nominal tool execution completed successfully");

  // =========================================================================
  // 6. Direct WorkflowAbortSignal & Type Guard isWorkflowAbortSignal Unit Tests
  // =========================================================================
  const directSignal = new WorkflowAbortSignal("CUSTOM_ABORT", { code: 42 });
  assert(directSignal instanceof Error, "WorkflowAbortSignal inherits from Error");
  assert(directSignal.__isWorkflowAbort === true, "Signal carries __isWorkflowAbort flag");
  assert(directSignal.reason === "CUSTOM_ABORT", "Signal stores reason");
  assert((directSignal.payload as any)?.code === 42, "Signal stores payload");

  // Type guard testing
  assert(isWorkflowAbortSignal(directSignal) === true, "isWorkflowAbortSignal returns true for signal instance");
  assert(
    isWorkflowAbortSignal({ __isWorkflowAbort: true, reason: "MOCK" }) === true,
    "isWorkflowAbortSignal returns true for plain object with flag"
  );
  assert(isWorkflowAbortSignal(new Error("regular error")) === false, "isWorkflowAbortSignal returns false for standard Error");
  assert(isWorkflowAbortSignal(null) === false, "isWorkflowAbortSignal returns false for null");
  assert(isWorkflowAbortSignal(undefined) === false, "isWorkflowAbortSignal returns false for undefined");
  assert(isWorkflowAbortSignal("random_string") === false, "isWorkflowAbortSignal returns false for string");
  assert(isWorkflowAbortSignal({ foo: "bar" }) === false, "isWorkflowAbortSignal returns false for unrelated object");

  // Direct return of WorkflowAbortSignal inside a step without ctx.abort()
  const directReturnWorkflow = defineWorkflow({
    id: "direct_signal_pipeline",
    name: "Pipeline retour direct de signal",
    inputSchema: z.object({ value: z.number() }),
    steps: [
      {
        id: "step_manual_return",
        name: "Retour manuel de signal",
        execute: async () => {
          return new WorkflowAbortSignal("MANUAL_RETURN_ABORT", { direct: true });
        },
      },
      {
        id: "step_should_be_skipped",
        name: "Étape ignorée",
        execute: async () => ({ executed: true }),
      },
    ],
  });

  const directReturnResult = await directReturnWorkflow.execute({ value: 10 });
  assert(directReturnResult.status === "ABORTED", "Workflow caught direct return of WorkflowAbortSignal");
  assert(directReturnResult.abortReason === "MANUAL_RETURN_ABORT", "Captured manual return abortReason");
  assert((directReturnResult.abortPayload as any)?.direct === true, "Captured manual return payload");

  console.log("\n🎉 All Graceful Abort (FEAT-015) tests passed successfully!");
}

runWorkflowAbortTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
