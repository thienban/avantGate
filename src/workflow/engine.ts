import { StepSuspendedError } from "../agent/errors";
import {
  WorkflowSagaRollbackError,
  WorkflowValidationError,
  type FailedCompensationRecord,
} from "./errors";
import type {
  WorkflowConfig,
  WorkflowExecutionContext,
  WorkflowExecutionResult,
  WorkflowStepConfig,
  WorkflowStepContext,
} from "./types";

function generateRunId(workflowId: string): string {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 9);
  return `run_${workflowId}_${timestamp}_${randomSuffix}`;
}

function validateInput<TInput>(config: WorkflowConfig<TInput, any>, input: TInput): TInput {
  const parseResult = config.inputSchema.safeParse(input);
  if (!parseResult.success) {
    throw new WorkflowValidationError(config.id, parseResult.error.issues);
  }
  return parseResult.data;
}

function createStepContext(params: {
  workflowId: string;
  stepId: string;
  runId: string;
  context?: WorkflowExecutionContext;
  stepResults: Record<string, any>;
}): WorkflowStepContext {
  const { workflowId, stepId, runId, context, stepResults } = params;

  return {
    workflowId,
    stepId,
    runId,
    tenantId: context?.tenantId,
    userId: context?.userId,
    services: context?.services ?? {},
    storage: context?.storage,
    getStepResult: <T = unknown>(id: string): T | undefined => stepResults[id] as T,
    waitForApproval: async <T = unknown>(options?: any): Promise<T> => {
      if (context?.storage) {
        const existing = await context.storage.getStep<T>(workflowId, stepId);
        if (existing && existing.status === "COMPLETED") {
          return (existing.result ?? options?.defaultResult) as T;
        }

        const now = new Date().toISOString();
        await context.storage.saveStep({
          workflowId,
          stepId,
          runId,
          status: "WAITING_APPROVAL",
          metadata: options?.metadata,
          createdAt: now,
          updatedAt: now,
        });
      }
      throw new StepSuspendedError(stepId, workflowId, options?.prompt);
    },
  };
}

async function rollbackSaga(params: {
  workflowId: string;
  failedStepId: string;
  originalError: unknown;
  completedSteps: Array<{ step: WorkflowStepConfig; result: any }>;
  input: any;
  runId: string;
  context?: WorkflowExecutionContext;
  stepResults: Record<string, any>;
}): Promise<never> {
  const {
    workflowId,
    failedStepId,
    originalError,
    completedSteps,
    input,
    runId,
    context,
    stepResults,
  } = params;

  const compensatedSteps: string[] = [];
  const failedCompensations: FailedCompensationRecord[] = [];

  // Parcours inverse des étapes complétées (Saga Compensation Pattern)
  for (let i = completedSteps.length - 1; i >= 0; i--) {
    const { step, result } = completedSteps[i];
    if (!step.compensate) {
      continue;
    }

    const stepCtx = createStepContext({
      workflowId,
      stepId: step.id,
      runId,
      context,
      stepResults,
    });

    try {
      await step.compensate(result, input, stepCtx);
      compensatedSteps.push(step.id);
      if (context?.storage) {
        await context.storage.updateStepStatus(workflowId, step.id, "FAILED", {
          metadata: { compensated: true },
        });
      }
    } catch (compensationError) {
      failedCompensations.push({ stepId: step.id, error: compensationError });
    }
  }

  throw new WorkflowSagaRollbackError({
    workflowId,
    failedStepId,
    originalError,
    compensatedSteps,
    failedCompensations,
  });
}

export async function executeWorkflow<TInput, TOutput>(
  config: WorkflowConfig<TInput, TOutput>,
  rawInput: TInput,
  context?: WorkflowExecutionContext
): Promise<WorkflowExecutionResult<TOutput>> {
  const input = validateInput(config, rawInput);
  const runId = context?.runId ?? generateRunId(config.id);
  const stepResults: Record<string, any> = {};
  const completedSteps: Array<{ step: WorkflowStepConfig; result: any }> = [];

  for (const step of config.steps) {
    const stepCtx = createStepContext({
      workflowId: config.id,
      stepId: step.id,
      runId,
      context,
      stepResults,
    });

    try {
      const result = await step.execute(input, stepCtx);
      stepResults[step.id] = result;
      completedSteps.push({ step, result });

      if (context?.storage) {
        await context.storage.updateStepStatus(config.id, step.id, "COMPLETED", { result });
      }
    } catch (error) {
      if (error instanceof StepSuspendedError) {
        return {
          workflowId: config.id,
          runId,
          status: "WAITING_APPROVAL",
          stepResults,
        };
      }

      await rollbackSaga({
        workflowId: config.id,
        failedStepId: step.id,
        originalError: error,
        completedSteps,
        input,
        runId,
        context,
        stepResults,
      });
    }
  }

  const finalOutput = config.outputDto
    ? config.outputDto(stepResults, input)
    : (stepResults as unknown as TOutput);

  return {
    workflowId: config.id,
    runId,
    status: "COMPLETED",
    stepResults,
    output: finalOutput,
  };
}
