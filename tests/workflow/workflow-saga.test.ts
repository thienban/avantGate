import { z } from "zod";
import {
  defineWorkflow,
  WorkflowSagaRollbackError,
  WorkflowValidationError,
} from "../../src/workflow";
import {
  MemoryStorageAdapter,
  ToolRegistry,
  ReadOnlyToolStrategy,
  MaxImpactToolStrategy,
} from "../../src/agent";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runWorkflowSagaTests() {
  console.log("🔄 Testing avantgate/workflow Engine & Saga Rollback (DESIGN-017)...\n");

  // =========================================================================
  // 1. Nominal Sequential Execution (Happy Path & Context Passing)
  // =========================================================================
  const orderSteps: string[] = [];
  const happyWorkflow = defineWorkflow({
    id: "onboarding_pipeline",
    name: "Pipeline d'intégration client",
    inputSchema: z.object({
      customerId: z.string(),
      plan: z.enum(["STARTER", "PRO", "ENTERPRISE"]),
    }),
    steps: [
      {
        id: "step_validate_customer",
        name: "Validation du client",
        execute: async (input) => {
          orderSteps.push("step_validate_customer");
          return { isValid: true, customerId: input.customerId };
        },
      },
      {
        id: "step_create_workspace",
        name: "Création du workspace",
        execute: async (input, ctx) => {
          orderSteps.push("step_create_workspace");
          const validation = ctx.getStepResult<{ isValid: boolean }>("step_validate_customer");
          assert(validation?.isValid === true, "Context passing retrieved previous step result");
          return { workspaceId: `ws_${input.customerId}` };
        },
      },
      {
        id: "step_assign_license",
        name: "Attribution de la licence",
        execute: async (input, ctx) => {
          orderSteps.push("step_assign_license");
          const ws = ctx.getStepResult<{ workspaceId: string }>("step_create_workspace");
          return { licenseKey: `lic_${input.plan}_${ws?.workspaceId}` };
        },
      },
    ],
    outputDto: (results, input) => ({
      success: true,
      customerId: input.customerId,
      workspaceId: results.step_create_workspace?.workspaceId,
      licenseKey: results.step_assign_license?.licenseKey,
    }),
  });

  const happyResult = await happyWorkflow.execute({
    customerId: "cust_123",
    plan: "PRO",
  });

  assert(happyResult.status === "COMPLETED", "Happy path completed successfully");
  assert(
    JSON.stringify(orderSteps) ===
      JSON.stringify(["step_validate_customer", "step_create_workspace", "step_assign_license"]),
    "Steps executed in strict sequential order"
  );
  assert(happyResult.output.success === true, "Output DTO projected accurately");
  assert(
    happyResult.output.licenseKey === "lic_PRO_ws_cust_123",
    "Final output aggregated values across steps"
  );

  // =========================================================================
  // 2. Input Validation (Zod Guard)
  // =========================================================================
  let validationErrorCaught = false;
  try {
    await happyWorkflow.execute({
      customerId: "cust_123",
      plan: "INVALID_PLAN" as any,
    });
  } catch (err) {
    if (err instanceof WorkflowValidationError) {
      validationErrorCaught = true;
    }
  }
  assert(validationErrorCaught, "WorkflowValidationError thrown upon invalid input schema");

  // =========================================================================
  // 4. Saga Pattern Rollback (Reverse Compensations in strict reverse order)
  // =========================================================================
  const compensationOrder: string[] = [];
  const sagaWorkflow = defineWorkflow({
    id: "transactional_booking",
    name: "Réservation transactionnelle avec compensation",
    inputSchema: z.object({ bookingId: z.string() }),
    steps: [
      {
        id: "step_reserve_hotel",
        name: "Réservation hôtel",
        execute: async () => {
          return { hotelRef: "hotel_abc" };
        },
        compensate: async (result) => {
          compensationOrder.push(`compensate_hotel_${result.hotelRef}`);
        },
      },
      {
        id: "step_reserve_flight",
        name: "Réservation vol",
        execute: async () => {
          return { flightRef: "flight_xyz" };
        },
        compensate: async (result) => {
          compensationOrder.push(`compensate_flight_${result.flightRef}`);
        },
      },
      {
        id: "step_charge_card",
        name: "Paiement carte bancaire (échoue)",
        execute: async () => {
          throw new Error("Bank gateway declined: insufficient funds");
        },
        compensate: async () => {
          compensationOrder.push("compensate_charge");
        },
      },
    ],
  });

  let sagaError: WorkflowSagaRollbackError | null = null;
  try {
    await sagaWorkflow.execute({ bookingId: "b_789" });
  } catch (err) {
    if (err instanceof WorkflowSagaRollbackError) {
      sagaError = err;
    }
  }

  assert(sagaError !== null, "WorkflowSagaRollbackError was thrown");
  assert(sagaError?.failedStepId === "step_charge_card", "Accurate failedStepId recorded");
  assert(
    JSON.stringify(sagaError?.compensatedSteps) ===
      JSON.stringify(["step_reserve_flight", "step_reserve_hotel"]),
    "Compensated steps list recorded in reverse execution order"
  );
  assert(
    JSON.stringify(compensationOrder) ===
      JSON.stringify(["compensate_flight_flight_xyz", "compensate_hotel_hotel_abc"]),
    "Saga executed compensation handlers in strict reverse order (flight then hotel)"
  );

  // =========================================================================
  // 4. Checkpoints & Human-in-the-Loop Suspension (waitForApproval)
  // =========================================================================
  const storage = new MemoryStorageAdapter();
  const hitlWorkflow = defineWorkflow({
    id: "wire_transfer_workflow",
    name: "Virement bancaire avec approbation humaine",
    inputSchema: z.object({ amount: z.number(), beneficiary: z.string() }),
    steps: [
      {
        id: "step_check_balance",
        name: "Vérification du solde",
        execute: async (input) => ({ hasFunds: input.amount <= 10000 }),
      },
      {
        id: "step_human_approval",
        name: "Approbation directeur financier",
        checkpoint: true,
        execute: async (input, ctx) => {
          return await ctx.waitForApproval<{ approved: boolean }>({
            prompt: `Confirmer le virement de ${input.amount}€ pour ${input.beneficiary}`,
            metadata: { amount: input.amount },
          });
        },
      },
      {
        id: "step_execute_transfer",
        name: "Exécution du virement",
        execute: async (input, ctx) => {
          const approval = ctx.getStepResult<{ approved: boolean }>("step_human_approval");
          return { transferExecuted: approval?.approved === true };
        },
      },
    ],
    outputDto: (results) => ({
      done: true,
      executed: results.step_execute_transfer?.transferExecuted,
    }),
  });

  // First run: suspends at step_human_approval
  const run1 = await hitlWorkflow.execute(
    { amount: 5000, beneficiary: "Fournisseur SA" },
    { storage }
  );

  assert(run1.status === "WAITING_APPROVAL", "Workflow suspended on checkpoint with WAITING_APPROVAL status");
  const storedStep = await storage.getStep("wire_transfer_workflow", "step_human_approval");
  assert(storedStep?.status === "WAITING_APPROVAL", "Storage saved step as WAITING_APPROVAL");

  // Simulate human approving the step in storage
  await storage.updateStepStatus("wire_transfer_workflow", "step_human_approval", "COMPLETED", {
    result: { approved: true },
  });

  // Second run: resumes using storage cached result
  const run2 = await hitlWorkflow.execute(
    { amount: 5000, beneficiary: "Fournisseur SA" },
    { storage, runId: run1.runId }
  );

  assert(run2.status === "COMPLETED", "Workflow resumed successfully after human approval");
  assert(run2.output.executed === true, "Subsequent steps executed after approval");

  // =========================================================================
  // 6. Transformation en Tool AI SDK (`workflow.asTool()`) & Gouvernance DESIGN-015
  // =========================================================================
  const mutativeTool = happyWorkflow.asTool();
  assert(mutativeTool._impact === "MUTATIVE", "asTool() defaulted impact to MUTATIVE");
  assert(mutativeTool._requireApproval === false, "asTool() defaulted requireApproval to false for MUTATIVE");
  assert((mutativeTool as any)._isWorkflow === true, "Tool carries _isWorkflow metadata");
  assert((mutativeTool as any).workflowId === "onboarding_pipeline", "Tool carries workflowId");

  // Direct tool execution
  const toolResult = await mutativeTool.execute({ customerId: "cust_456", plan: "ENTERPRISE" });
  assert(toolResult.success === true, "Workflow tool executed seamlessly via tool.execute()");
  assert(toolResult.customerId === "cust_456", "Workflow tool returned expected DTO");

  // Safe Defaults: Destructive Workflow activates requireApproval: true
  const destructiveWorkflow = defineWorkflow({
    id: "gdpr_purge_pipeline",
    name: "Purge RGPD client",
    impact: "DESTRUCTIVE",
    inputSchema: z.object({ customerId: z.string() }),
    steps: [
      {
        id: "purge_step",
        name: "Purge définitive",
        execute: async () => ({ purged: true }),
      },
    ],
  });

  const destructiveTool = destructiveWorkflow.asTool();
  assert(destructiveTool._impact === "DESTRUCTIVE", "Destructive workflow tool preserved DESTRUCTIVE impact");
  assert(destructiveTool._requireApproval === true, "Safe default: DESTRUCTIVE workflow tool auto-activated requireApproval: true");

  // Explicit override preserved
  const autoDestructiveTool = destructiveWorkflow.asTool({ requireApproval: false });
  assert(autoDestructiveTool._requireApproval === false, "Explicit requireApproval: false override preserved");

  // =========================================================================
  // 7. Registry & Confinement avec ReadOnlyToolStrategy
  // =========================================================================
  const registry = new ToolRegistry();
  registry.register(mutativeTool);
  registry.register(destructiveTool);

  const allTools = registry.getAll();
  const readOnlyStrategy = new ReadOnlyToolStrategy();
  const selectedReadOnlyTools = readOnlyStrategy.selectTools(allTools, {});
  assert(selectedReadOnlyTools.length === 0, "ReadOnlyToolStrategy correctly filtered out all MUTATIVE and DESTRUCTIVE workflow tools");

  const maxMutativeStrategy = new MaxImpactToolStrategy("MUTATIVE");
  const selectedMutativeTools = maxMutativeStrategy.selectTools(allTools, {});
  assert(selectedMutativeTools.length === 1, "MaxImpactToolStrategy('MUTATIVE') selected only onboarding_pipeline");
  assert(selectedMutativeTools[0].name === "onboarding_pipeline", "onboarding_pipeline matched MUTATIVE impact");

  console.log("\n🎉 All avantgate/workflow & Saga Rollback tests passed successfully!\n");
}

runWorkflowSagaTests().catch((err) => {
  console.error("❌ Workflow test suite failed:", err);
  process.exit(1);
});
