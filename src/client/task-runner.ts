import { TaskState, UseTaskOptions } from "./task-types";
import {
  createInitialTaskState,
  deriveOpaqueTaskId,
  generateRunId,
  validateRetryEligibility,
} from "./task-utils";

export type TaskRunnerOptions<TInput, TOutput> = UseTaskOptions<TInput, TOutput>;

export interface TaskRunner<TInput, TOutput> {
  getState: () => TaskState<TOutput>;
  subscribe: (listener: (state: TaskState<TOutput>) => void) => () => void;
  run: (input: TInput) => Promise<TOutput>;
  retry: () => Promise<TOutput>;
  reset: () => void;
  updateOptions: (newOptions: Partial<UseTaskOptions<TInput, TOutput>>) => void;
  destroy: () => void;
}

export const createTaskRunner = <TInput, TOutput>(
  initialOptions: UseTaskOptions<TInput, TOutput>
): TaskRunner<TInput, TOutput> => {
  let options = { ...initialOptions };
  let opaqueTaskId = deriveOpaqueTaskId(options.taskName, options.tenantSalt);
  let state = createInitialTaskState<TOutput>(opaqueTaskId, options.tenantId);
  let lastInput: TInput | null = null;
  const listeners = new Set<(state: TaskState<TOutput>) => void>();

  const notify = (): void => {
    listeners.forEach((listener) => listener(state));
  };

  const setState = (updater: (prev: TaskState<TOutput>) => TaskState<TOutput>): void => {
    state = updater(state);
    notify();
  };

  const markExecutionStart = (newRunId: string, parentRunId?: string): void => {
    setState((prev) => ({
      ...prev,
      isRunning: true,
      isFailed: false,
      isSuccess: false,
      error: null,
      attempts: prev.attempts + 1,
      runId: newRunId,
      parentRunId: parentRunId ?? null,
    }));
  };

  const handleExecutionSuccess = (result: TOutput): void => {
    setState((prev) => ({
      ...prev,
      isRunning: false,
      isSuccess: true,
      data: result,
    }));
    options.onSuccess?.(result);
  };

  const handleExecutionError = (err: unknown): Error => {
    const errorObj = err instanceof Error ? err : new Error(String(err));
    setState((prev) => ({
      ...prev,
      isRunning: false,
      isFailed: true,
      error: errorObj,
    }));
    options.onError?.(errorObj);
    return errorObj;
  };

  const executeTask = async (
    input: TInput,
    parentRunId?: string
  ): Promise<TOutput> => {
    lastInput = input;
    const newRunId = generateRunId(opaqueTaskId);
    markExecutionStart(newRunId, parentRunId);

    try {
      const result = await options.handler(input, {
        runId: newRunId,
        parentRunId,
        attempt: state.attempts,
        taskId: opaqueTaskId,
        tenantId: options.tenantId,
      });
      handleExecutionSuccess(result);
      return result;
    } catch (err: unknown) {
      throw handleExecutionError(err);
    }
  };

  const run = (input: TInput): Promise<TOutput> => {
    state = { ...state, attempts: 0 };
    return executeTask(input);
  };

  const retry = (): Promise<TOutput> => {
    validateRetryEligibility({
      isRunning: state.isRunning,
      attemptCount: state.attempts,
      maxRetries: options.maxManualRetries ?? 3,
      hasPreviousInput: lastInput !== null,
    });

    return executeTask(lastInput as TInput, state.runId ?? undefined);
  };

  const reset = (): void => {
    lastInput = null;
    setState(() => createInitialTaskState<TOutput>(opaqueTaskId, options.tenantId));
  };

  const updateOptions = (
    newOptions: Partial<UseTaskOptions<TInput, TOutput>>
  ): void => {
    options = { ...options, ...newOptions };
    opaqueTaskId = deriveOpaqueTaskId(options.taskName, options.tenantSalt);
    setState((prev) => ({
      ...prev,
      taskId: opaqueTaskId,
      tenantId: options.tenantId ?? null,
    }));
  };

  const subscribe = (
    listener: (state: TaskState<TOutput>) => void
  ): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const destroy = (): void => {
    listeners.clear();
  };

  return {
    getState: () => state,
    subscribe,
    run,
    retry,
    reset,
    updateOptions,
    destroy,
  };
};
