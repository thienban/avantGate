import { DtoValidationError, ToolAccessDeniedError } from "./errors";
import { auditToolResult } from "./guardrails";
import type {
  IsolatedToolConfig,
  TenantToolConfig,
  ToolExecutionContext,
  VercelAiCoreTool,
} from "./types";

const verifyRoles = (
  configuredRoles: readonly string[] | string[] | undefined,
  context: ToolExecutionContext,
  toolIdentifier: string
): void => {
  if (!configuredRoles || configuredRoles.length === 0) {
    return;
  }
  const userRoles: string[] = [
    ...(context.roles ?? []),
    ...(context.role ? [context.role] : []),
  ];
  const hasAllowedRole = configuredRoles.some((role) => userRoles.includes(role));
  if (!hasAllowedRole) {
    throw new ToolAccessDeniedError(
      toolIdentifier,
      "Access denied: insufficient role permissions"
    );
  }
};

const verifyDataAccessGuard = async <TArgs>(
  guard: ((args: TArgs, context?: ToolExecutionContext) => boolean | Promise<boolean>) | undefined,
  args: TArgs,
  context: ToolExecutionContext,
  toolIdentifier: string
): Promise<void> => {
  if (!guard) {
    return;
  }
  const isAllowed = await guard(args, context);
  if (!isAllowed) {
    throw new ToolAccessDeniedError(toolIdentifier, "Access denied by data access guard");
  }
};

const verifyTenantIsolation = <TResult>(
  assertTenant: ((result: TResult) => string | undefined | null) | undefined,
  rawResult: TResult,
  context: ToolExecutionContext,
  toolIdentifier: string
): void => {
  if (!assertTenant) {
    return;
  }
  if (!context.tenantId) {
    throw new ToolAccessDeniedError(
      toolIdentifier,
      "Access denied: missing session tenantId in execution context for multi-tenant tool"
    );
  }
  const recordTenantId = assertTenant(rawResult);
  if (recordTenantId && recordTenantId !== context.tenantId) {
    throw new ToolAccessDeniedError(
      toolIdentifier,
      `Cross-tenant IDOR access violation: record tenant '${recordTenantId}' does not match session tenant '${context.tenantId}'`
    );
  }
};

const verifyResourceOwnership = async <TResult>(
  assertOwnership: ((result: TResult, context: ToolExecutionContext) => boolean | Promise<boolean>) | undefined,
  rawResult: TResult,
  context: ToolExecutionContext,
  toolIdentifier: string
): Promise<void> => {
  if (!assertOwnership) {
    return;
  }
  const isOwner = await assertOwnership(rawResult, context);
  if (!isOwner) {
    throw new ToolAccessDeniedError(
      toolIdentifier,
      "Ownership IDOR access violation: user does not own or have access to this resource"
    );
  }
};

const checkSuspiciousParameters = (
  parameters: unknown,
  toolName: string
): void => {
  if (!parameters || typeof parameters !== "object") {
    return;
  }
  const zodShape = (parameters as { shape?: Record<string, unknown> }).shape;
  if (!zodShape || typeof zodShape !== "object") {
    return;
  }
  const suspiciousKeys = ["tenantId", "tenant_id", "ownerTenantId"];
  for (const key of suspiciousKeys) {
    if (key in zodShape) {
      console.warn(
        `[avantGate Security Warning] Tool '${toolName}' defines '${key}' as a model parameter. ` +
        `Tenancy should be inferred from the trusted server context (context.tenantId) rather than supplied by the untrusted model to prevent IDOR attacks.`
      );
    }
  }
};

const resolveInvalidationTags = async <TArgs, TResult>(
  config: IsolatedToolConfig<TArgs, TResult, any, any>,
  args: TArgs,
  rawResult: TResult,
  context?: ToolExecutionContext
): Promise<string[] | undefined> => {
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
};

const dispatchClientData = async (
  rawResult: unknown,
  callback?: (data: any) => void | Promise<void>
): Promise<void> => {
  if (!callback) {
    return;
  }
  await callback(rawResult);
};

const produceLlmPayload = async <TArgs, TResult>(
  rawResult: TResult,
  args: TArgs,
  context?: ToolExecutionContext,
  transformer?: (result: TResult, args: TArgs, context?: ToolExecutionContext) => unknown
): Promise<unknown> => {
  if (transformer) {
    return await transformer(rawResult, args, context);
  }
  return rawResult;
};

const validateLlmDto = (
  payload: unknown,
  schema: any,
  toolIdentifier: string
): unknown => {
  const parseResult = schema.safeParse(payload);
  if (!parseResult.success) {
    const issues = parseResult.error.issues ?? [];
    const errorMessages = issues
      .map((issue: any) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join(", ");
    throw new DtoValidationError(toolIdentifier, errorMessages, issues);
  }
  return parseResult.data;
};

const protectLlmPayload = (
  payload: unknown,
  toolIdentifier: string,
  sanitizePii = true,
  throwOnPii = false
): { sanitized: unknown; count: number } => {
  if (!sanitizePii) {
    return { sanitized: payload, count: 0 };
  }
  const { sanitizedData, maskedCount } = auditToolResult(payload, {
    toolName: toolIdentifier,
    throwOnPii,
  });
  return { sanitized: sanitizedData, count: maskedCount };
};

const processLlmPayload = async <TArgs, TResult>(
  rawResult: TResult,
  args: TArgs,
  context: ToolExecutionContext,
  config: IsolatedToolConfig<TArgs, TResult, any, any>,
  toolIdentifier: string
): Promise<{ sanitized: unknown; count: number }> => {
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
};

/**
 * Creates an isolated tool compatible with Vercel AI SDK (ai) tool contract.
 * Features dual-channel separation (client data vs minimal LLM DTO),
 * access governance (domain, resource, roles, dataAccessGuard, assertTenant, assertOwnership, invalidationTags),
 * stable ID, aliasing, caching, Zod DTO contract validation, and automatic in-flight PII redaction.
 */
export const createIsolatedTool = <
  TArgs = any,
  TResult = any,
  TLLMDto = unknown,
  TClientDto = TResult
>(
  config: IsolatedToolConfig<TArgs, TResult, TLLMDto, TClientDto>
): VercelAiCoreTool<TArgs, TResult> => {
  const toolId = config.id || config.name;
  const toolAlias = config.alias;
  const clientCallback = config.clientDto;
  const toolIdentifier = toolAlias || config.name;
  const toolImpact = config.impact ?? "READ_ONLY";
  const requireApproval = config.requireApproval ?? (toolImpact === "DESTRUCTIVE");

  checkSuspiciousParameters(config.parameters, config.name);

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
    execute: async (args: TArgs, context?: ToolExecutionContext): Promise<any> => {
      const updatedContext: ToolExecutionContext = {
        ...context,
        callChain: context?.callChain ?? Object.freeze([toolId]),
      };

      verifyRoles(config.roles, updatedContext, toolIdentifier);

      await verifyDataAccessGuard(
        config.dataAccessGuard,
        args,
        updatedContext,
        toolIdentifier
      );

      const rawResult = await config.execute(args, updatedContext);

      verifyTenantIsolation(config.assertTenant, rawResult, updatedContext, toolIdentifier);

      await verifyResourceOwnership(
        config.assertOwnership,
        rawResult,
        updatedContext,
        toolIdentifier
      );

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
};

/**
 * High-assurance factory for multi-tenant and user-owned tools.
 * Compile-time enforcement: strictly requires either assertTenant or assertOwnership.
 */
export const createTenantTool = <
  TArgs = any,
  TResult = any,
  TLLMDto = unknown,
  TClientDto = TResult
>(
  config: TenantToolConfig<TArgs, TResult, TLLMDto, TClientDto>
): VercelAiCoreTool<TArgs, TResult> => {
  return createIsolatedTool(config);
};

