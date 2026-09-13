import { MemoryStorageAdapter } from "./adapters/memory-adapter";
import { StepExecutionError, StepSuspendedError } from "./errors";
import type {
  StepApprovalOptions,
  StepRecord,
  StepRunnerConfig,
  StepRunnerContext,
  StepStorageAdapter,
} from "./types";

export interface StepRunnerInstance extends StepRunnerContext {
  storage: StepStorageAdapter;
  approveStep<T = unknown>(stepId: string, approvalData?: T): Promise<void>;
  rejectStep(stepId: string, reason?: string): Promise<void>;
}

async function fetchCachedResult<T>(
  storage: StepStorageAdapter,
  workflowId: string,
  stepId: string
): Promise<{ isCompleted: boolean; result?: T }> {
  const existing = await storage.getStep<T>(workflowId, stepId);
  if (existing && existing.status === "COMPLETED") {
    return { isCompleted: true, result: existing.result };
  }
  return { isCompleted: false };
}

async function markStepRunning(
  storage: StepStorageAdapter,
  workflowId: string,
  stepId: string,
  runId?: string
): Promise<void> {
  const now = new Date().toISOString();
  await storage.saveStep({
    workflowId,
    stepId,
    runId,
    status: "RUNNING",
    createdAt: now,
    updatedAt: now,
  });
}

async function handleStepFailure(
  storage: StepStorageAdapter,
  workflowId: string,
  stepId: string,
  error: unknown
): Promise<never> {
  if (error instanceof StepSuspendedError) {
    throw error;
  }
  const errorMsg = error instanceof Error ? error.message : String(error);
  await storage.updateStepStatus(workflowId, stepId, "FAILED", {
    error: errorMsg,
  });
  throw new StepExecutionError(stepId, workflowId, errorMsg, error);
}

async function executeWithPersistence<T>(
  storage: StepStorageAdapter,
  workflowId: string,
  stepId: string,
  runId: string | undefined,
  executeFn: () => Promise<T>
): Promise<T> {
  const cache = await fetchCachedResult<T>(storage, workflowId, stepId);
  if (cache.isCompleted) {
    return cache.result as T;
  }

  await markStepRunning(storage, workflowId, stepId, runId);

  try {
    const result = await executeFn();
    await storage.updateStepStatus(workflowId, stepId, "COMPLETED", { result });
    return result;
  } catch (error) {
    return handleStepFailure(storage, workflowId, stepId, error);
  }
}

async function handleWaitForApproval<T>(
  storage: StepStorageAdapter,
  workflowId: string,
  stepId: string,
  runId?: string,
  options?: StepApprovalOptions<T>
): Promise<T> {
  const existing = await storage.getStep<T>(workflowId, stepId);
  if (existing && existing.status === "COMPLETED") {
    return (existing.result ?? options?.defaultResult) as T;
  }

  const now = new Date().toISOString();
  const stepRecord: StepRecord<T> = {
    workflowId,
    stepId,
    runId,
    status: "WAITING_APPROVAL",
    metadata: options?.metadata,
    result: options?.defaultResult,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await storage.saveStep(stepRecord);
  throw new StepSuspendedError(stepId, workflowId, options?.metadata);
}

/**
 * Creates a serverless durable step runner for stateful multi-step agent execution
 * with automatic idempotence and Human-in-the-Loop approval capability.
 */
export function createStepRunner(config: StepRunnerConfig): StepRunnerInstance {
  const { workflowId, runId = config.runId ?? config.workflowId, storage = new MemoryStorageAdapter() } = config;

  return {
    workflowId,
    storage,
    async run<T>(stepId: string, executeFn: () => Promise<T>): Promise<T> {
      return executeWithPersistence<T>(storage, workflowId, stepId, runId, executeFn);
    },
    async waitForApproval<T = unknown>(
      stepId: string,
      options?: StepApprovalOptions<T>
    ): Promise<T> {
      return handleWaitForApproval<T>(storage, workflowId, stepId, runId, options);
    },
    async approveStep<T = unknown>(stepId: string, approvalData?: T): Promise<void> {
      await storage.updateStepStatus(workflowId, stepId, "COMPLETED", {
        result: approvalData,
      });
    },
    async rejectStep(stepId: string, reason?: string): Promise<void> {
      await storage.updateStepStatus(workflowId, stepId, "FAILED", {
        error: reason ?? "Rejected by human operator",
      });
    },
  };
}
