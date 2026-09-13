import {
  CircularToolCallError,
  ToolCallDepthExceededError,
  ToolNotFoundError,
  ToolSubCallQuotaError,
} from "./errors";
import { ToolRegistry } from "./registry";
import { createToolSharedState } from "./tool-state";
import type {
  StepStorageAdapter,
  ToolExecutionContext,
  ToolExecutionRecord,
} from "./types";

export interface ToolInvokerOptions {
  maxDepth?: number;
  maxTotalSubCalls?: number;
  workflowId?: string;
  stepId?: string;
}

export interface ToolInvoker {
  invokeTool<TResult = unknown>(
    toolId: string,
    args: unknown,
    context?: ToolExecutionContext
  ): Promise<TResult>;
}

function buildCacheKey(toolId: string, args: unknown): string {
  try {
    return `avantgate:cache:${toolId}:${JSON.stringify(args)}`;
  } catch {
    return `avantgate:cache:${toolId}:${String(args)}`;
  }
}

function validateCallLimits(
  registeredId: string,
  parentChain: readonly string[],
  maxDepth: number,
  totalCalls: number,
  maxTotalCalls: number
): void {
  if (totalCalls > maxTotalCalls) {
    throw new ToolSubCallQuotaError(totalCalls, maxTotalCalls);
  }
  if (parentChain.includes(registeredId)) {
    throw new CircularToolCallError([...parentChain, registeredId]);
  }
  if (parentChain.length >= maxDepth) {
    throw new ToolCallDepthExceededError(parentChain.length + 1, maxDepth);
  }
}

async function recordExecution(
  storage: StepStorageAdapter | undefined,
  record: ToolExecutionRecord
): Promise<void> {
  if (!storage?.saveToolExecution) {
    return;
  }
  try {
    await storage.saveToolExecution(record);
  } catch {
    // Non-blocking telemetry
  }
}

/**
 * Creates an intelligent, concurrency-safe tool invoker with cycle detection,
 * depth guard, result caching, and database execution tracing.
 */
export function createToolInvoker(
  registry: ToolRegistry,
  storage?: StepStorageAdapter,
  options: ToolInvokerOptions = {}
): ToolInvoker {
  const {
    maxDepth = 5,
    maxTotalSubCalls = 20,
    workflowId = options.workflowId,
    stepId = options.stepId,
  } = options;

  let totalCallsCount = 0;
  const sharedState = createToolSharedState(storage);

  const invoker: ToolInvoker = {
    async invokeTool<TResult = unknown>(
      toolId: string,
      args: unknown,
      context?: ToolExecutionContext
    ): Promise<TResult> {
      totalCallsCount++;
      const registered = registry.get(toolId);
      if (!registered) {
        throw new ToolNotFoundError(toolId);
      }

      const parentChain = context?.callChain ?? [];
      validateCallLimits(
        registered.id,
        parentChain,
        maxDepth,
        totalCallsCount,
        maxTotalSubCalls
      );

      const cacheKey = buildCacheKey(registered.id, args);
      const cacheTTL = registered.tool._cacheTTL;

      if (cacheTTL && storage?.getCachedToolResult) {
        const cached = await storage.getCachedToolResult<TResult>(cacheKey);
        if (cached !== null && cached !== undefined) {
          return cached;
        }
      }

      const activeChain = Object.freeze([...parentChain, registered.id]);
      const childContext: ToolExecutionContext = {
        ...context,
        workflowId: context?.workflowId ?? workflowId,
        stepId: context?.stepId ?? stepId,
        callChain: activeChain,
        state: sharedState,
        storage,
        callTool: (subId, subArgs) =>
          invoker.invokeTool(subId, subArgs, childContext),
      };

      const startTime = Date.now();
      const parentId = parentChain[parentChain.length - 1];

      const runId = context?.runId ?? childContext.workflowId;

      try {
        const result = (await registered.tool.execute(args, childContext)) as TResult;
        const durationMs = Date.now() - startTime;

        if (cacheTTL && storage?.setCachedToolResult) {
          await storage.setCachedToolResult(cacheKey, result, cacheTTL);
        }

        const piiFilteredCount = registered.tool._lastPiiFilteredCount ?? 0;

        await recordExecution(storage, {
          executionId: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          workflowId: childContext.workflowId,
          stepId: childContext.stepId,
          runId,
          toolId: registered.id,
          parentToolId: parentId,
          aliasUsed: registered.alias,
          depth: activeChain.length,
          inputArgs: args,
          outputSummary: result,
          durationMs,
          status: "SUCCESS",
          piiFilteredCount,
          tokens: childContext.tokens,
          costUsd: childContext.costUsd,
          createdAt: new Date().toISOString(),
        });

        return result;
      } catch (error) {
        const durationMs = Date.now() - startTime;
        const errorMsg = error instanceof Error ? error.message : String(error);

        await recordExecution(storage, {
          executionId: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          workflowId: childContext.workflowId,
          stepId: childContext.stepId,
          runId,
          toolId: registered.id,
          parentToolId: parentId,
          aliasUsed: registered.alias,
          depth: activeChain.length,
          inputArgs: args,
          durationMs,
          status: "FAILED",
          error: errorMsg,
          tokens: childContext.tokens,
          costUsd: childContext.costUsd,
          createdAt: new Date().toISOString(),
        });

        throw error;
      }
    },
  };

  return invoker;
}
