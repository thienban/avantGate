/**
 * Context provided to task handlers during execution.
 */
export interface TaskExecutionContext {
  runId: string;
  parentRunId?: string;
  attempt: number;
  taskId: string;
  tenantId?: string;
}

/**
 * Configuration options for the useTask hook.
 */
export interface UseTaskOptions<TInput, TOutput> {
  taskName: string;
  tenantId?: string;
  tenantSalt?: string;
  maxManualRetries?: number;
  handler: (input: TInput, context: TaskExecutionContext) => Promise<TOutput>;
  onSuccess?: (data: TOutput) => void;
  onError?: (error: Error) => void;
}

/**
 * State snapshot of the task lifecycle.
 */
export interface TaskState<TOutput> {
  isRunning: boolean;
  isFailed: boolean;
  isSuccess: boolean;
  attempts: number;
  error: Error | null;
  data: TOutput | null;
  runId: string | null;
  parentRunId: string | null;
  taskId: string;
  tenantId: string | null;
}

/**
 * Return interface of useTask.
 */
export interface UseTaskReturn<TInput, TOutput> extends TaskState<TOutput> {
  run: (input: TInput) => Promise<TOutput>;
  retry: () => Promise<TOutput>;
  reset: () => void;
}
