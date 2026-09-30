import { useCallback, useEffect, useRef, useState } from "react";
import {
  TaskState,
  TaskExecutionContext,
  UseTaskOptions,
  UseTaskReturn,
} from "./task-types";
import { deriveOpaqueTaskId } from "./task-utils";
import {
  createTaskRunner,
  type TaskRunner,
  type TaskRunnerOptions,
} from "./task-runner";

export {
  deriveOpaqueTaskId,
  createTaskRunner,
  type TaskState,
  type TaskExecutionContext,
  type UseTaskOptions,
  type UseTaskReturn,
  type TaskRunner,
  type TaskRunnerOptions,
};

export const useTask = <TInput, TOutput>(
  options: UseTaskOptions<TInput, TOutput>
): UseTaskReturn<TInput, TOutput> => {
  const runnerRef = useRef<TaskRunner<TInput, TOutput> | null>(null);

  if (!runnerRef.current) {
    runnerRef.current = createTaskRunner(options);
  }

  const [state, setState] = useState<TaskState<TOutput>>(() =>
    runnerRef.current!.getState()
  );

  useEffect(() => {
    runnerRef.current?.updateOptions(options);
  });

  useEffect(() => {
    const runner = runnerRef.current;
    if (!runner) return;
    return runner.subscribe(setState);
  }, []);

  useEffect(() => {
    return () => {
      runnerRef.current?.destroy();
      runnerRef.current = null;
    };
  }, []);

  const run = useCallback(
    (input: TInput): Promise<TOutput> => runnerRef.current!.run(input),
    []
  );

  const retry = useCallback(
    (): Promise<TOutput> => runnerRef.current!.retry(),
    []
  );

  const reset = useCallback((): void => {
    runnerRef.current!.reset();
  }, []);

  return {
    ...state,
    run,
    retry,
    reset,
  };
};
