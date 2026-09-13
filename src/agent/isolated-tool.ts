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
  toolName: string,
  sanitizePii = true,
  throwOnPii = false
): unknown {
  if (!sanitizePii) {
    return payload;
  }
  const { sanitizedData } = auditToolResult(payload, {
    toolName,
    throwOnPii,
  });
  return sanitizedData;
}

/**
 * Creates an isolated tool compatible with Vercel AI SDK (ai) tool contract.
 * Features dual-channel separation (client data vs minimal LLM summary)
 * and automatic in-flight PII redaction.
 */
export function createIsolatedTool<TArgs = any, TResult = any>(
  config: IsolatedToolConfig<TArgs, TResult>
): VercelAiCoreTool<TArgs, TResult> {
  const tool: VercelAiCoreTool<TArgs, TResult> = {
    description: config.description,
    parameters: config.parameters,
    _toolName: config.name,
    _isIsolated: true,
    async execute(args: TArgs, context?: ToolExecutionContext): Promise<any> {
      const rawResult = await config.execute(args, context);

      await dispatchClientData(rawResult, config.toClientData);

      const llmPayload = produceLlmPayload(
        rawResult,
        args,
        config.toLLMSummary
      );

      return protectLlmPayload(
        llmPayload,
        config.name,
        config.sanitizePii !== false,
        config.throwOnPii === true
      );
    },
  };

  return tool;
}
