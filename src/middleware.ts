import type {
  AvantGateMiddleware,
  BeforeRequestContext,
  BeforeRequestResult,
  AfterResponseContext,
  ChatMessage,
} from "./types";

export interface BeforeExecutionState {
  messages: ChatMessage[];
  metadata?: Record<string, unknown>;
  shortCircuit?: BeforeRequestResult["shortCircuit"];
}

export interface AfterExecutionState {
  responseText: string;
  metadata?: Record<string, unknown>;
}

export const applySingleBeforeMiddleware = async (
  middleware: AvantGateMiddleware,
  current: BeforeExecutionState,
  model: string,
  temperature?: number
): Promise<BeforeExecutionState> => {
  if (!middleware.beforeRequest) return current;
  const result = await middleware.beforeRequest({
    messages: current.messages,
    model,
    temperature,
    metadata: current.metadata,
  });
  if (!result) return current;
  return {
    messages: result.messages ?? current.messages,
    shortCircuit: result.shortCircuit,
    metadata: current.metadata,
  };
};

export const executeBeforeRequestHooks = async (
  middlewares: AvantGateMiddleware[] | undefined,
  context: BeforeRequestContext
): Promise<BeforeExecutionState> => {
  if (!middlewares || middlewares.length === 0) {
    return { messages: context.messages, metadata: context.metadata };
  }
  let current: BeforeExecutionState = {
    messages: context.messages,
    metadata: context.metadata,
  };
  for (const middleware of middlewares) {
    current = await applySingleBeforeMiddleware(middleware, current, context.model, context.temperature);
    if (current.shortCircuit) return current;
  }
  return current;
};

export const applySingleAfterMiddleware = async (
  middleware: AvantGateMiddleware,
  current: AfterExecutionState,
  baseContext: Omit<AfterResponseContext, "responseText" | "metadata">
): Promise<AfterExecutionState> => {
  if (!middleware.afterResponse) return current;
  const result = await middleware.afterResponse({
    ...baseContext,
    responseText: current.responseText,
    metadata: current.metadata,
  });
  if (!result) return current;
  return {
    responseText: result.responseText ?? current.responseText,
    metadata: result.metadata ?? current.metadata,
  };
};

export const executeAfterResponseHooks = async (
  middlewares: AvantGateMiddleware[] | undefined,
  context: AfterResponseContext
): Promise<AfterExecutionState> => {
  if (!middlewares || middlewares.length === 0) {
    return { responseText: context.responseText, metadata: context.metadata };
  }
  let current: AfterExecutionState = {
    responseText: context.responseText,
    metadata: context.metadata,
  };
  for (const middleware of middlewares) {
    current = await applySingleAfterMiddleware(middleware, current, context);
  }
  return current;
};
