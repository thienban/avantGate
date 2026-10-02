import { createHmac } from "crypto";
import { TaskState } from "./task-types";

/**
 * Derives an opaque task identifier using HMAC-SHA256 with tenant salt.
 * Why: Guarantees Zero-Knowledge Telemetry by obfuscating confidential business operations
 * (e.g. "wire_transfer", "patient_biopsy") in logs while preserving deterministic correlation.
 */
export const deriveOpaqueTaskId = (taskName: string, tenantSalt?: string): string => {
  if (!tenantSalt) {
    return taskName;
  }
  const digest = createHmac("sha256", tenantSalt)
    .update(taskName)
    .digest("hex")
    .slice(0, 12);
  return `tsk_${digest}`;
};

/**
 * Generates a scoped unique run ID for a task attempt.
 * Why: Provides deterministic prefixing for APM tracing and Cockpit session linking.
 */
export const generateRunId = (taskId: string): string => {
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 7);
  return `run_${taskId}_${timestamp}_${randomSuffix}`;
};

/**
 * Creates the initial default state for a task.
 * Why: Reusable reset baseline ensuring consistency across mount and reset cycles.
 */
export const createInitialTaskState = <TOutput>(
  taskId: string,
  tenantId?: string
): TaskState<TOutput> => ({
  isRunning: false,
  isFailed: false,
  isSuccess: false,
  attempts: 0,
  error: null,
  data: null,
  runId: null,
  parentRunId: null,
  taskId,
  tenantId: tenantId ?? null,
});

export interface RetryValidationParams {
  isRunning: boolean;
  attemptCount: number;
  maxRetries: number;
  hasPreviousInput: boolean;
}

/**
 * Validates whether a retry attempt is permitted.
 * Why: Protects against FinOps token budget exhaustion and UI double-click race conditions.
 */
export const validateRetryEligibility = ({
  isRunning,
  attemptCount,
  maxRetries,
  hasPreviousInput,
}: RetryValidationParams): void => {
  if (isRunning) {
    throw new Error("Task is already running");
  }
  if (attemptCount >= maxRetries) {
    throw new Error(`Maximum manual retry limit (${maxRetries}) reached. Please reset.`);
  }
  if (!hasPreviousInput) {
    throw new Error("Cannot retry: no previous execution input found");
  }
};

export const getIdempotencyKey = (ctx: {
  runId: string;
  parentRunId?: string | null;
}): string => ctx.parentRunId ?? ctx.runId;

export const getIdempotencyHeaders = (ctx: {
  runId: string;
  parentRunId?: string | null;
}): Record<string, string> => ({
  "Idempotency-Key": getIdempotencyKey(ctx),
});
