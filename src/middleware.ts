import type {
  AvantGateMiddleware,
  BeforeRequestContext,
  BeforeRequestResult,
  AfterResponseContext,
  AfterResponseResult,
  ChatMessage,
} from "./types";
import { ChatMessagesArraySchema } from "./types";
import { deepFreeze } from "./utils/immutability";
import { MiddlewareTimeoutError, InvalidMessageSchemaError } from "./errors";

export interface BeforeExecutionState {
  messages: ChatMessage[];
  metadata?: Record<string, unknown>;
  shortCircuit?: BeforeRequestResult["shortCircuit"];
}

export interface AfterExecutionState {
  responseText: string;
  metadata?: Record<string, unknown>;
}

const executeWithTimeout = async <T>(
  action: () => Promise<T> | T,
  timeoutMs: number,
  middlewareName: string,
  phase: "beforeRequest" | "afterResponse"
): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new MiddlewareTimeoutError(middlewareName, phase, timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([Promise.resolve(action()), timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const validateReturnedMessages = (messages: unknown, middlewareName: string): void => {
  if (!messages) return;
  const parseResult = ChatMessagesArraySchema.safeParse(messages);
  if (!parseResult.success) {
    throw new InvalidMessageSchemaError(middlewareName, parseResult.error.format());
  }
};

export const applySingleBeforeMiddleware = async (
  middleware: AvantGateMiddleware,
  current: BeforeExecutionState,
  model: string,
  temperature?: number,
  timeoutMs = 5000
): Promise<BeforeExecutionState> => {
  if (!middleware.beforeRequest) return current;

  const frozenMessages = deepFreeze([...current.messages]);
  const frozenMetadata = current.metadata ? deepFreeze({ ...current.metadata }) : undefined;

  const result = await executeWithTimeout(
    () =>
      middleware.beforeRequest!({
        messages: frozenMessages,
        model,
        temperature,
        metadata: frozenMetadata,
      }),
    timeoutMs,
    middleware.name,
    "beforeRequest"
  );

  if (!result) return current;

  validateReturnedMessages(result.messages, middleware.name);

  return {
    messages: result.messages ?? current.messages,
    shortCircuit: result.shortCircuit,
    metadata: current.metadata,
  };
};

export const executeBeforeRequestHooks = async (
  middlewares: AvantGateMiddleware[] | undefined,
  context: BeforeRequestContext,
  timeoutMs = 5000
): Promise<BeforeExecutionState> => {
  if (!middlewares || middlewares.length === 0) {
    return { messages: context.messages as ChatMessage[], metadata: context.metadata };
  }
  let current: BeforeExecutionState = {
    messages: context.messages as ChatMessage[],
    metadata: context.metadata,
  };
  for (const middleware of middlewares) {
    current = await applySingleBeforeMiddleware(
      middleware,
      current,
      context.model,
      context.temperature,
      timeoutMs
    );
    if (current.shortCircuit) return current;
  }
  return current;
};

export const applySingleAfterMiddleware = async (
  middleware: AvantGateMiddleware,
  current: AfterExecutionState,
  baseContext: Omit<AfterResponseContext, "responseText" | "metadata">,
  timeoutMs = 5000
): Promise<AfterExecutionState> => {
  if (!middleware.afterResponse) return current;

  const frozenMetadata = current.metadata ? deepFreeze({ ...current.metadata }) : undefined;

  const result = await executeWithTimeout(
    () =>
      middleware.afterResponse!({
        ...baseContext,
        responseText: current.responseText,
        metadata: frozenMetadata,
      }),
    timeoutMs,
    middleware.name,
    "afterResponse"
  );

  if (!result) return current;
  return {
    responseText: result.responseText ?? current.responseText,
    metadata: result.metadata ?? current.metadata,
  };
};

export const executeAfterResponseHooks = async (
  middlewares: AvantGateMiddleware[] | undefined,
  context: AfterResponseContext,
  timeoutMs = 5000
): Promise<AfterExecutionState> => {
  if (!middlewares || middlewares.length === 0) {
    return { responseText: context.responseText, metadata: context.metadata };
  }
  let current: AfterExecutionState = {
    responseText: context.responseText,
    metadata: context.metadata,
  };
  for (const middleware of middlewares) {
    current = await applySingleAfterMiddleware(middleware, current, context, timeoutMs);
  }
  return current;
};
