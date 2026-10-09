import { AmbiguousToolExecutionError, StepSuspendedError } from "./errors";
import type {
  StepStorageAdapter,
  ToolExecutionStatus,
  ToolResilienceOptions,
  ToolResilienceRecord,
  ToolResilienceResult,
} from "./types";

const MAX_FALLBACK_CAP = 1000;
const inMemoryFallbackStore = new Map<string, ToolResilienceRecord>();

export const clearResilienceFallbackStore = (): void => {
  inMemoryFallbackStore.clear();
};

const setFallbackRecord = (toolCallId: string, record: ToolResilienceRecord): void => {
  if (inMemoryFallbackStore.size >= MAX_FALLBACK_CAP) {
    const firstKey = inMemoryFallbackStore.keys().next().value;
    if (firstKey) inMemoryFallbackStore.delete(firstKey);
  }
  inMemoryFallbackStore.set(toolCallId, record);
};

const isDeterministicClientError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const err = error as Record<string, unknown>;
  const status = Number(err.status ?? err.statusCode);
  if (status >= 400 && status < 500 && status !== 408 && status !== 429) {
    return true;
  }
  return err.name === "DtoValidationError" || err.name === "ToolAccessDeniedError";
};

const isAmbiguousTimeoutError = (error: unknown, isTimedOut: boolean): boolean => {
  if (isTimedOut) return true;
  if (!error || typeof error !== "object") return false;
  const err = error as Record<string, unknown>;
  const name = String(err.name ?? "");
  const status = Number(err.status ?? err.statusCode);
  if (name === "AbortError" || name === "TimeoutError") return true;
  if (status === 408 || status === 502 || status === 503 || status === 504) return true;
  const msg = String(err.message ?? "").toLowerCase();
  const code = String(err.code ?? "").toLowerCase();
  return ["timeout", "etimedout", "econnreset", "socket hang up", "network error", "fetch failed"]
    .some((key) => msg.includes(key) || code.includes(key));
};

const classifyErrorStatus = (error: unknown, isTimedOut: boolean): ToolExecutionStatus => {
  if (isDeterministicClientError(error)) {
    return "FAILED";
  }
  if (isAmbiguousTimeoutError(error, isTimedOut)) {
    return "UNCONFIRMED_TIMEOUT";
  }
  return "FAILED";
};

export const getToolExecutionRecord = async <TResult = unknown>(
  storage: StepStorageAdapter | undefined,
  toolCallId: string
): Promise<ToolResilienceRecord<TResult> | null> => {
  if (!storage) {
    return (inMemoryFallbackStore.get(toolCallId) as ToolResilienceRecord<TResult>) ?? null;
  }
  if (storage.getStateValue) {
    const val = await storage.getStateValue<ToolResilienceRecord<TResult>>(`tool_resilience:${toolCallId}`);
    if (val) return val;
    const directVal = await storage.getStateValue<ToolResilienceRecord<TResult>>(toolCallId);
    if (directVal) return directVal;
  }
  const step = await storage.getStep<ToolResilienceRecord<TResult>>("_tool_resilience", toolCallId);
  return (step?.metadata?.resilienceRecord as ToolResilienceRecord<TResult>) ?? null;
};

const saveToStateStorage = async (
  storage: StepStorageAdapter,
  toolCallId: string,
  record: ToolResilienceRecord
): Promise<void> => {
  if (!storage.setStateValue) return;
  await storage.setStateValue(`tool_resilience:${toolCallId}`, record);
  await storage.setStateValue(toolCallId, record);
};

const saveResilienceRecord = async <TResult>(
  storage: StepStorageAdapter | undefined,
  record: ToolResilienceRecord<TResult>
): Promise<void> => {
  if (!storage) {
    setFallbackRecord(record.toolCallId, record as ToolResilienceRecord);
    return;
  }
  await saveToStateStorage(storage, record.toolCallId, record as ToolResilienceRecord);
  const status = record.status === "COMPLETED" ? "COMPLETED" : record.status === "FAILED" ? "FAILED" : "RUNNING";
  await storage.saveStep({
    workflowId: "_tool_resilience",
    stepId: record.toolCallId,
    status,
    result: record.result,
    error: record.error,
    metadata: { resilienceRecord: record },
    createdAt: new Date(record.startedAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
  });
};

const handleAmbiguousFailure = (
  options: ToolResilienceOptions<any, any>,
  originalError?: unknown
): never => {
  const workflowId = options.workflowId ?? "_tool_resilience";
  if (options.suspendOnAmbiguous) {
    throw new StepSuspendedError(options.toolCallId, workflowId, {
      toolCallId: options.toolCallId,
      impact: options.impact,
      reason: "Ambiguous mutation requires human intervention",
      originalError,
    });
  }
  throw new AmbiguousToolExecutionError({
    toolCallId: options.toolCallId,
    toolName: options.toolName,
    impact: options.impact,
    message: "Ambiguous execution state (UNCONFIRMED_TIMEOUT). Re-execution blocked without reconciliation.",
    originalError,
  });
};

const saveReconciledRecord = async <TArgs, TResult>(
  options: ToolResilienceOptions<TArgs, TResult>,
  result: TResult | undefined
): Promise<ToolResilienceResult<TResult>> => {
  await saveResilienceRecord(options.storage, {
    toolCallId: options.toolCallId,
    status: "COMPLETED",
    result,
    impact: options.impact,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  });
  return { result: result as TResult, isCached: true, status: "COMPLETED" };
};

const tryReconciliation = async <TArgs, TResult>(
  options: ToolResilienceOptions<TArgs, TResult>
): Promise<ToolResilienceResult<TResult>> => {
  if (!options.onAmbiguousRetry) {
    return handleAmbiguousFailure(options);
  }
  try {
    const outcome = await options.onAmbiguousRetry({ toolCallId: options.toolCallId, args: options.args as TArgs });
    if (!outcome.reconciled) {
      return handleAmbiguousFailure(options);
    }
    return await saveReconciledRecord(options, outcome.result);
  } catch (err) {
    if (err instanceof StepSuspendedError || err instanceof AmbiguousToolExecutionError) throw err;
    return handleAmbiguousFailure(options, err);
  }
};

const checkExistingState = async <TArgs, TResult>(
  options: ToolResilienceOptions<TArgs, TResult>
): Promise<ToolResilienceResult<TResult> | null> => {
  const existing = await getToolExecutionRecord<TResult>(options.storage, options.toolCallId);
  if (!existing) {
    return null;
  }
  if (existing.status === "COMPLETED") {
    return { result: existing.result as TResult, isCached: true, status: "COMPLETED" };
  }
  if (existing.status === "UNCONFIRMED_TIMEOUT") {
    if (options.impact === "READ_ONLY") {
      return null;
    }
    return await tryReconciliation(options);
  }
  return null;
};

interface ExecutionOutcome<TResult> {
  result?: TResult;
  error?: unknown;
  isTimedOut: boolean;
}

const executeActionWithTimeout = async <TResult>(
  action: (signal: AbortSignal, idempotencyKey: string) => Promise<TResult>,
  timeoutMs: number,
  idempotencyKey: string
): Promise<ExecutionOutcome<TResult>> => {
  const controller = new AbortController();
  let isTimedOut = false;
  const timer = setTimeout(() => {
    isTimedOut = true;
    controller.abort(new Error(`Tool execution timed out after ${timeoutMs}ms`));
  }, timeoutMs);
  try {
    const result = await action(controller.signal, idempotencyKey);
    return { result, isTimedOut: false };
  } catch (error) {
    return { error, isTimedOut };
  } finally {
    clearTimeout(timer);
  }
};

const saveFailureRecord = async <TArgs, TResult>(
  options: ToolResilienceOptions<TArgs, TResult>,
  startedAt: number,
  error: unknown,
  isTimedOut: boolean
): Promise<never> => {
  const status = classifyErrorStatus(error, isTimedOut);
  const errorMsg = error instanceof Error ? error.message : String(error);
  await saveResilienceRecord(options.storage, {
    toolCallId: options.toolCallId,
    status,
    error: errorMsg,
    impact: options.impact,
    startedAt,
    updatedAt: Date.now(),
  });
  throw error;
};

const saveSuccessRecord = async <TArgs, TResult>(
  options: ToolResilienceOptions<TArgs, TResult>,
  startedAt: number,
  result: TResult
): Promise<ToolResilienceResult<TResult>> => {
  await saveResilienceRecord(options.storage, {
    toolCallId: options.toolCallId,
    status: "COMPLETED",
    result,
    impact: options.impact,
    startedAt,
    updatedAt: Date.now(),
  });
  return { result, isCached: false, status: "COMPLETED" };
};

const claimExecutionIntent = async <TArgs, TResult>(
  options: ToolResilienceOptions<TArgs, TResult>,
  startedAt: number
): Promise<void> => {
  await saveResilienceRecord(options.storage, {
    toolCallId: options.toolCallId,
    status: "CLAIMED",
    impact: options.impact,
    startedAt,
    updatedAt: startedAt,
  });
};

export const withToolResilience = async <TArgs = any, TResult = any>(
  options: ToolResilienceOptions<TArgs, TResult>
): Promise<ToolResilienceResult<TResult>> => {
  const existingResult = await checkExistingState(options);
  if (existingResult) {
    return existingResult;
  }
  const startedAt = Date.now();
  const idempotencyKey = options.idempotencyKey || options.toolCallId;
  await claimExecutionIntent(options, startedAt);
  const timeoutMs = options.timeoutMs ?? 30_000;
  const outcome = await executeActionWithTimeout(options.action, timeoutMs, idempotencyKey);
  if (outcome.error) {
    return await saveFailureRecord(options, startedAt, outcome.error, outcome.isTimedOut);
  }
  return await saveSuccessRecord(options, startedAt, outcome.result as TResult);
};
