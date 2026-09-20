import { DtoValidationError, ToolAccessDeniedError } from "./errors";
import { auditToolResult } from "./guardrails";
import type {
  IsolatedToolConfig,
  ToolExecutionContext,
  VercelAiCoreTool,
} from "./types";

async function verifyDataAccessGuard<TArgs>(
  guard: ((args: TArgs, context?: ToolExecutionContext) => boolean | Promise<boolean>) | undefined,
  args: TArgs,
  context: ToolExecutionContext,
  toolIdentifier: string
): Promise<void> {
  if (!guard) {
    return;
  }
  const isAllowed = await guard(args, context);
  if (!isAllowed) {
    throw new ToolAccessDeniedError(toolIdentifier, "Access denied by data access guard");
  }
}

async function resolveInvalidationTags<TArgs, TResult>(
  config: IsolatedToolConfig<TArgs, TResult, any, any>,
  args: TArgs,
  rawResult: TResult,
  context?: ToolExecutionContext
): Promise<string[] | undefined> {
  if (!config.invalidationTags) {
    return undefined;
  }
  const tags =
    typeof config.invalidationTags === "function"
      ? await config.invalidationTags(args, rawResult)
      : config.invalidationTags;

  if (tags && tags.length > 0 && context?.onInvalidationTags) {
    await context.onInvalidationTags(tags);
  }
  return tags;
}

async function dispatchClientData(
  rawResult: unknown,
  callback?: (data: any) => void | Promise<void>
): Promise<void> {
  if (!callback) {
    return;
  }
  await callback(rawResult);
}

async function produceLlmPayload<TArgs, TResult>(
  rawResult: TResult,
  args: TArgs,
  context?: ToolExecutionContext,
  transformer?: (result: TResult, args: TArgs, context?: ToolExecutionContext) => unknown
): Promise<unknown> {
  if (transformer) {
    return await transformer(rawResult, args, context);
  }
  return rawResult;
}

function validateLlmDto(
  payload: unknown,
  schema: any,
  toolIdentifier: string
): unknown {
  const parseResult = schema.safeParse(payload);
  if (!parseResult.success) {
    const issues = parseResult.error.issues ?? [];
    const errorMessages = issues
      .map((issue: any) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join(", ");
    throw new DtoValidationError(
      toolIdentifier,
      errorMessages,
      issues
    );
  }
  return parseResult.data;
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

async function processLlmPayload<TArgs, TResult>(
  rawResult: TResult,
  args: TArgs,
  context: ToolExecutionContext,
  config: IsolatedToolConfig<TArgs, TResult, any, any>,
  toolIdentifier: string
): Promise<{ sanitized: unknown; count: number }> {
  let payload = await produceLlmPayload(rawResult, args, context, config.llmDto);

  if (config.llmDtoSchema) {
    payload = validateLlmDto(payload, config.llmDtoSchema, toolIdentifier);
  }

  return protectLlmPayload(
    payload,
    toolIdentifier,
    config.sanitizePii !== false,
    config.throwOnPii === true
  );
}

/**
 * Creates an isolated tool compatible with Vercel AI SDK (ai) tool contract.
 * Features dual-channel separation (client data vs minimal LLM DTO),
 * access governance (domain, resource, roles, dataAccessGuard, invalidationTags),
 * stable ID, aliasing, caching, Zod DTO contract validation, and automatic in-flight PII redaction.
 */
export function createIsolatedTool<
  TArgs = any,
  TResult = any,
  TLLMDto = unknown,
  TClientDto = TResult
>(
  config: IsolatedToolConfig<TArgs, TResult, TLLMDto, TClientDto>
): VercelAiCoreTool<TArgs, TResult> {
  const toolId = config.id || config.name;
  const toolAlias = config.alias;
  const clientCallback = config.clientDto;
  const toolIdentifier = toolAlias || config.name;
  const toolImpact = config.impact ?? "READ_ONLY";
  const requireApproval = config.requireApproval ?? (toolImpact === "DESTRUCTIVE");

  const tool: VercelAiCoreTool<TArgs, TResult> = {
    description: config.description,
    parameters: config.parameters,
    _toolId: toolId,
    _toolName: config.name,
    _toolAlias: toolAlias,
    _isIsolated: true,
    _cacheTTL: config.cacheTTL,
    _domain: config.domain,
    _resource: config.resource,
    _roles: config.roles ? Object.freeze([...config.roles]) : undefined,
    _impact: toolImpact,
    _requireApproval: requireApproval,
    _lastPiiFilteredCount: 0,
    _lastInvalidationTags: undefined,
    async execute(args: TArgs, context?: ToolExecutionContext): Promise<any> {
      const updatedContext: ToolExecutionContext = {
        ...context,
        callChain: context?.callChain ?? Object.freeze([toolId]),
      };

      await verifyDataAccessGuard(
        config.dataAccessGuard,
        args,
        updatedContext,
        toolIdentifier
      );

      const rawResult = await config.execute(args, updatedContext);

      const tags = await resolveInvalidationTags(
        config,
        args,
        rawResult,
        updatedContext
      );
      if (tags) {
        tool._lastInvalidationTags = tags;
      }

      await dispatchClientData(rawResult, clientCallback);

      const protection = await processLlmPayload(
        rawResult,
        args,
        updatedContext,
        config,
        toolIdentifier
      );

      tool._lastPiiFilteredCount = protection.count;
      return protection.sanitized;
    },
  };

  return tool;
}
