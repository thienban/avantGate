import { auditToolResult } from "./guardrails";
import type {
  IsolatedToolConfig,
  ToolExecutionContext,
  VercelAiCoreTool,
} from "./types";

async function dispatchClientData<TResult>(
  rawResult: TResult,
  callback?: (data: TResult) => void | Promise<void>
): Promise<void> {
  if (!callback) {
    return;
  }
  await callback(rawResult);
}

function produceLlmPayload<TArgs, TResult>(
  rawResult: TResult,
  args: TArgs,
  transformer?: (result: TResult, args: TArgs) => unknown
): unknown {
  if (transformer) {
    return transformer(rawResult, args);
  }
  return rawResult;
}

function protectLlmPayload(
  payload: unknown,
  toolIdentifier: string,
  sanitizePii = true,
  throwOnPii = false
): { sanitized: unknown; count: number } {
  if (!sanitizePii) {
    return { sanitized: payload, count: 0 };
  }
  const { sanitizedData, maskedCount } = auditToolResult(payload, {
    toolName: toolIdentifier,
    throwOnPii,
  });
  return { sanitized: sanitizedData, count: maskedCount };
}

/**
 * Creates an isolated tool compatible with Vercel AI SDK (ai) tool contract.
 * Features dual-channel separation (client data vs minimal LLM summary),
 * stable ID, aliasing, caching and automatic in-flight PII redaction.
 */
export function createIsolatedTool<TArgs = any, TResult = any>(
  config: IsolatedToolConfig<TArgs, TResult>
): VercelAiCoreTool<TArgs, TResult> {
  const toolId = config.id || config.name;
  const toolAlias = config.alias;

  const tool: VercelAiCoreTool<TArgs, TResult> = {
    description: config.description,
    parameters: config.parameters,
    _toolId: toolId,
    _toolName: config.name,
    _toolAlias: toolAlias,
    _isIsolated: true,
    _cacheTTL: config.cacheTTL,
    _lastPiiFilteredCount: 0,
    async execute(args: TArgs, context?: ToolExecutionContext): Promise<any> {
      const updatedContext: ToolExecutionContext = {
        ...context,
        callChain: context?.callChain ?? Object.freeze([toolId]),
      };

      const rawResult = await config.execute(args, updatedContext);

      await dispatchClientData(rawResult, config.toClientData);

      const llmPayload = produceLlmPayload(
        rawResult,
        args,
        config.toLLMSummary
      );

      const protection = protectLlmPayload(
        llmPayload,
        toolAlias || config.name,
        config.sanitizePii !== false,
        config.throwOnPii === true
      );

      tool._lastPiiFilteredCount = protection.count;
      return protection.sanitized;
    },
  };

  return tool;
}
