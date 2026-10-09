import { z } from "zod";
import type {
  ControlLayerConfig,
  ExecutionResult,
  StructuredExecutionResult,
  GenerateStructuredOutputOptions,
  LLMProviderPort,
  ChatMessage,
  ProviderConfig,
  LLMUsage,
  BeforeRequestResult,
  BudgetReservation,
} from "./types";
import { ConfigurationError, BudgetExceededError } from "./types";
import { validateUserInput } from "./input-guard";
import { sanitizePII } from "./sanitizer";
import { calculateCostUSD, CachedPricingAdapter, resolveModelPriceAsync } from "./pricing";
import { validateWithZod } from "./response-validator";
import { createHttpProviderClient } from "./providers/http-client";
import { applyOutputGuards, sanitizeCustomTerms } from "./secret-guard";
import { executeBeforeRequestHooks, executeAfterResponseHooks } from "./middleware";
import { PromptInjectionError } from "./errors";


interface ProviderDispatchOutput {
  responseText: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number; promptCacheHitTokens?: number };
  modelUsed: string;
  failoverOccurred: boolean;
  attempts: number;
}

export class AvantGateControlLayer {
  private config: ControlLayerConfig;
  private cachedPricingAdapter?: CachedPricingAdapter;
  private reservations = new Map<string, BudgetReservation>();
  private cachedProviderChain: ProviderConfig[];

  constructor(config: ControlLayerConfig) {
    this.config = {
      ...config,
      primary: this.resolveProviderConfig(config.primary)!,
      fallback: this.resolveProviderConfig(config.fallback),
      emergencyFallback: this.resolveProviderConfig(config.emergencyFallback),
    };

    this.cachedProviderChain = [
      this.config.primary,
      this.config.fallback,
      this.config.emergencyFallback,
    ].filter((provider): provider is ProviderConfig => Boolean(provider?.client));

    if (config.pricingAdapter) {
      this.cachedPricingAdapter = new CachedPricingAdapter(
        config.pricingAdapter,
        config.pricingCacheTtlMs ?? 5 * 60 * 1000
      );
    }
  }

  getReservation = (id: string): BudgetReservation | undefined => {
    return this.reservations.get(id);
  };

  getAllReservations = (): BudgetReservation[] => {
    return Array.from(this.reservations.values());
  };


  private resolveProviderConfig = (provider?: ProviderConfig): ProviderConfig | undefined => {
    if (!provider) return undefined;
    if (provider.client) return provider;
    if (provider.apiKey || provider.baseUrl || provider.provider === "ollama") {
      return {
        ...provider,
        client: createHttpProviderClient(provider),
      };
    }
    return provider;
  };

  private findProviderConfig = (provider?: string, model?: string): ProviderConfig | undefined => {
    if (provider) {
      if (this.config.primary.provider === provider) return this.config.primary;
      if (this.config.fallback?.provider === provider) return this.config.fallback;
      if (this.config.emergencyFallback?.provider === provider) return this.config.emergencyFallback;
    }
    if (model) {
      if (this.config.primary.model === model) return this.config.primary;
      if (this.config.fallback?.model === model) return this.config.fallback;
      if (this.config.emergencyFallback?.model === model) return this.config.emergencyFallback;
    }
    return this.config.primary;
  };

  private calculateCost = (
    model: string,
    promptTokens: number,
    completionTokens: number,
    cacheHitTokens: number = 0,
    provider?: string
  ): number => {
    const providerCfg = this.findProviderConfig(provider, model);
    return calculateCostUSD(model, promptTokens, completionTokens, cacheHitTokens, {
      provider: provider ?? providerCfg?.provider,
      providerPricing: providerCfg?.pricing,
      customPricing: this.config.customPricing,
      adapter: this.cachedPricingAdapter,
    });
  };

  private applySecurityGuards = (userQuery: string): string => {
    const guard = validateUserInput(userQuery, {
      detectInjection: this.config.security?.detectPromptInjection,
      maxLength: this.config.security?.maxInputLength,
    });

    if (!guard.valid) {
      throw new PromptInjectionError(guard.blockedReason ?? "Prompt injection detected");
    }

    let processed = userQuery;

    if (this.config.security?.customRedactionTerms && this.config.security.customRedactionTerms.length > 0) {
      processed = sanitizeCustomTerms(processed, this.config.security.customRedactionTerms).text;
    }

    if (this.config.security?.maskPII) {
      return sanitizePII(processed).text;
    }

    return processed;
  };

  private reScanMessagesAfterHooks = (
    originalMessages: ChatMessage[],
    updatedMessages: ChatMessage[]
  ): ChatMessage[] => {
    if (this.config.reScanIngressAfterHooks === false || originalMessages === updatedMessages) {
      return updatedMessages;
    }

    return updatedMessages.map((msg, idx) => {
      const orig = originalMessages[idx];
      if (orig && (orig === msg || (orig.role === msg.role && orig.content === msg.content))) {
        return msg;
      }
      return {
        ...msg,
        content: this.applySecurityGuards(msg.content),
      };
    });
  };

  private applyOutputSecurityGuards = (rawOutput: string): string => {
    const isDlpEnabled = this.config.security?.outputDLP ?? this.config.security?.maskPII ?? false;
    const shouldCheckSecrets = this.config.security?.blockSecretLeaks ?? true;
    const customTerms = this.config.security?.customRedactionTerms;

    if (!isDlpEnabled && !shouldCheckSecrets && (!customTerms || customTerms.length === 0)) {
      return rawOutput;
    }

    const guardResult = applyOutputGuards(rawOutput, {
      maskPII: isDlpEnabled,
      blockSecretLeaks: shouldCheckSecrets,
      secretLeakAction: this.config.security?.secretLeakAction ?? "REDACT",
      customRedactionTerms: customTerms,
    });

    return guardResult.text;
  };

  private validateTokenBudget = (estimatedTokens: number): void => {
    if (this.config.maxTokenBudget !== undefined && estimatedTokens > this.config.maxTokenBudget) {
      throw new BudgetExceededError(
        `[AvantGate Budget Guard] Pre-flight token budget exceeded: estimated prompt (${estimatedTokens} tokens) exceeds maxTokenBudget (${this.config.maxTokenBudget}).`
      );
    }
  };

  private validatePricingConfigured = async (
    targetModel: string,
    provider?: string
  ): Promise<void> => {
    const isLocalFree = provider === "ollama" || targetModel.toLowerCase().includes("ollama");
    if (isLocalFree) return;

    const providerCfg = this.findProviderConfig(provider, targetModel);
    const price = await resolveModelPriceAsync(targetModel, {
      provider: provider ?? providerCfg?.provider,
      providerPricing: providerCfg?.pricing,
      customPricing: this.config.customPricing,
      adapter: this.cachedPricingAdapter,
    });

    if (!price) {
      throw new ConfigurationError(
        `[AvantGate Configuration Error] 'maxCostUSD' was set to $${this.config.maxCostUSD}, but no pricing was configured for model '${targetModel}'. Please define pricing in ProviderConfig, customPricing, or via PricingAdapter.`
      );
    }
  };

  private evaluatePessimisticSolvency = (
    estimatedPromptCost: number,
    parentRunId?: string
  ): void => {
    if (!parentRunId || this.config.maxCostUSD === undefined) return;

    let hasUnconfirmed = false;
    let settledSpend = 0;

    for (const r of this.reservations.values()) {
      if (r.parentRunId !== parentRunId) continue;
      if (r.status === "UNCONFIRMED_TIMEOUT") hasUnconfirmed = true;
      if (r.status === "SETTLED") {
        settledSpend += r.settledCostUsd ?? r.estimatedCostUsd;
      }
    }

    if (!hasUnconfirmed) return;
    const totalWorstCaseCost = settledSpend + 2 * estimatedPromptCost;

    if (totalWorstCaseCost > this.config.maxCostUSD) {
      throw new BudgetExceededError(
        `[AvantGate FinOps Guard] Retry rejected: worst-case cumulative spend ($${totalWorstCaseCost.toFixed(4)}) exceeds max budget ($${this.config.maxCostUSD.toFixed(4)}).`
      );
    }
  };

  private createBudgetReservation = (
    estimatedCostUsd: number,
    parentRunId?: string
  ): BudgetReservation => {
    const reservationId = `res_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const reservation: BudgetReservation = {
      id: reservationId,
      parentRunId,
      estimatedCostUsd,
      status: "RESERVED",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (this.reservations.size >= 10000) {
      const oldestKey = this.reservations.keys().next().value;
      if (oldestKey) this.reservations.delete(oldestKey);
    }

    this.reservations.set(reservationId, reservation);
    return reservation;
  };

  private checkPreflightBudget = async (
    estimatedPromptTokens: number,
    targetModel: string,
    provider?: string,
    parentRunId?: string
  ): Promise<BudgetReservation | undefined> => {
    this.validateTokenBudget(estimatedPromptTokens);

    if (this.config.maxCostUSD === undefined) {
      return undefined;
    }

    await this.validatePricingConfigured(targetModel, provider);
    const estimatedPromptCost = this.calculateCost(targetModel, estimatedPromptTokens, 0, 0, provider);

    this.evaluatePessimisticSolvency(estimatedPromptCost, parentRunId);

    if (estimatedPromptCost > this.config.maxCostUSD) {
      throw new BudgetExceededError(
        `[AvantGate Budget Guard] Pre-flight cost budget exceeded: estimated prompt cost ($${estimatedPromptCost.toFixed(6)}) exceeds maxCostUSD ($${this.config.maxCostUSD}).`
      );
    }

    return this.createBudgetReservation(estimatedPromptCost, parentRunId);
  };



  private checkPostExecutionBudget = (tokensTotal: number, costUSD: number): void => {
    if (this.config.maxTokenBudget !== undefined && tokensTotal > this.config.maxTokenBudget) {
      throw new BudgetExceededError(
        `[AvantGate Budget Guard] Execution total tokens (${tokensTotal}) exceeded maxTokenBudget (${this.config.maxTokenBudget}).`
      );
    }
    if (this.config.maxCostUSD !== undefined && costUSD > this.config.maxCostUSD) {
      throw new BudgetExceededError(
        `[AvantGate Budget Guard] Execution cost ($${costUSD.toFixed(6)}) exceeded maxCostUSD ($${this.config.maxCostUSD}).`
      );
    }
  };

  private buildMessages = (systemPrompt: string | undefined, query: string): ChatMessage[] => {
    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: query });
    return messages;
  };

  private resolveTokens = (rawUsage: LLMUsage | undefined, query: string, text: string) => {
    const promptTokens = rawUsage?.promptTokens ?? Math.ceil(query.length / 4);
    const completionTokens = rawUsage?.completionTokens ?? Math.ceil(text.length / 4);
    const totalTokens = rawUsage?.totalTokens ?? promptTokens + completionTokens;
    return {
      promptTokens,
      completionTokens,
      totalTokens,
      promptCacheHitTokens: rawUsage?.promptCacheHitTokens,
    };
  };

  private getProviderChain = (): ProviderConfig[] => {
    return this.cachedProviderChain;
  };

  private executeSimulation = (
    query: string,
    systemPrompt?: string,
    modelOverride?: string
  ): ExecutionResult => {
    const targetModel = modelOverride ?? this.config.primary.model;
    const promptTokens = Math.ceil(((systemPrompt?.length ?? 0) + query.length) / 4);
    const completionTokens = 50;
    const cost = this.calculateCost(targetModel, promptTokens, completionTokens);

    return {
      text: `[AvantGate In-Process Engine] Response simulation for model: ${targetModel}`,
      tokens: {
        prompt: promptTokens,
        completion: completionTokens,
        total: promptTokens + completionTokens,
      },
      costUSD: cost,
      modelUsed: targetModel,
      failoverOccurred: false,
      attempts: 1,
    };
  };

  private executeOverrideProvider = async (
    provider: LLMProviderPort,
    messages: ChatMessage[],
    query: string,
    temperature?: number
  ): Promise<ProviderDispatchOutput> => {
    const response = await provider.complete({
      model: this.config.primary.model,
      messages,
      temperature: temperature ?? 0.2,
    });
    const usage = this.resolveTokens(response.usage, query, response.text);
    return {
      responseText: response.text,
      usage,
      modelUsed: this.config.primary.model,
      failoverOccurred: false,
      attempts: 1,
    };
  };

  private executeProviderPipeline = async (
    messages: ChatMessage[],
    query: string,
    temperature?: number,
    modelOverride?: string
  ): Promise<ProviderDispatchOutput> => {
    const chain = this.getProviderChain();
    let lastError: unknown;

    for (let index = 0; index < chain.length; index++) {
      const providerConfig = chain[index];
      const targetModel = (index === 0 && modelOverride) ? modelOverride : providerConfig.model;
      try {
        const response = await providerConfig.client!.complete({
          model: targetModel,
          messages,
          temperature: temperature ?? 0.2,
        });
        const usage = this.resolveTokens(response.usage, query, response.text);
        return {
          responseText: response.text,
          usage,
          modelUsed: targetModel,
          failoverOccurred: index > 0,
          attempts: index + 1,
        };
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  };

  private assembleResult = (output: ProviderDispatchOutput): ExecutionResult => {
    const sanitizedText = this.applyOutputSecurityGuards(output.responseText);
    const costUSD = this.calculateCost(
      output.modelUsed,
      output.usage.promptTokens,
      output.usage.completionTokens,
      output.usage.promptCacheHitTokens ?? 0
    );

    return {
      text: sanitizedText,
      tokens: {
        prompt: output.usage.promptTokens,
        completion: output.usage.completionTokens,
        total: output.usage.totalTokens,
      },
      costUSD,
      modelUsed: output.modelUsed,
      failoverOccurred: output.failoverOccurred,
      attempts: output.attempts,
    };
  };

  private notifyAuditSink = async (result: ExecutionResult): Promise<void> => {
    if (!this.config.auditSink) {
      return;
    }

    await this.config.auditSink.log({
      timestamp: new Date(),
      model: result.modelUsed,
      tokens: result.tokens,
      costUSD: result.costUSD,
      failoverOccurred: result.failoverOccurred,
      attempts: result.attempts,
    });
  };

  private prepareInputMessages = (options: {
    userQuery?: string;
    systemPrompt?: string;
    messages?: ChatMessage[];
  }): ChatMessage[] => {
    if (options.messages && options.messages.length > 0) {
      return this.sanitizeIncomingMessages(options.messages);
    }
    if (options.userQuery !== undefined) {
      const sanitizedQuery = this.applySecurityGuards(options.userQuery);
      return this.buildMessages(options.systemPrompt, sanitizedQuery);
    }
    throw new ConfigurationError("[AvantGate Input Guard] Either 'userQuery' or 'messages' must be provided.");
  };

  private handleShortCircuit = async (
    shortCircuit: NonNullable<BeforeRequestResult["shortCircuit"]>,
    targetModel: string
  ): Promise<ExecutionResult> => {
    const sanitizedText = this.applyOutputSecurityGuards(shortCircuit.text);
    const result: ExecutionResult = {
      text: sanitizedText,
      tokens: {
        prompt: shortCircuit.tokens?.promptTokens ?? 0,
        completion: shortCircuit.tokens?.completionTokens ?? 0,
        total: shortCircuit.tokens?.totalTokens ?? 0,
      },
      costUSD: shortCircuit.costUSD ?? 0,
      modelUsed: `${targetModel}:shortcircuit`,
      failoverOccurred: false,
      attempts: 0,
    };
    await this.notifyAuditSink(result);
    return result;
  };

  private dispatchPromptExecution = async (
    messages: ChatMessage[],
    temperature?: number,
    providerOverride?: LLMProviderPort
  ): Promise<ProviderDispatchOutput> => {
    const query = messages[messages.length - 1]?.content ?? "";
    if (providerOverride) {
      return this.executeOverrideProvider(providerOverride, messages, query, temperature);
    }
    if (this.getProviderChain().length === 0) {
      if (this.config.mockSimulation) {
        const sim = this.executeSimulation(query);
        return {
          responseText: sim.text,
          usage: { promptTokens: sim.tokens.prompt, completionTokens: sim.tokens.completion, totalTokens: sim.tokens.total },
          modelUsed: sim.modelUsed,
          failoverOccurred: false,
          attempts: 1,
        };
      }
      throw new ConfigurationError(
        "[AvantGate Configuration Error] No active LLM provider configured. Provide a client implementing LLMProviderPort or configure credentials (apiKey / baseUrl)."
      );
    }
    return this.executeProviderPipeline(messages, query, temperature);
  };

  private finalizeExecutionResult = async (
    output: ProviderDispatchOutput,
    responseText: string
  ): Promise<ExecutionResult> => {
    const sanitizedText = this.applyOutputSecurityGuards(responseText);
    const hitTokens = output.usage.promptCacheHitTokens ?? 0;
    const costUSD = this.calculateCost(output.modelUsed, output.usage.promptTokens, output.usage.completionTokens, hitTokens);
    this.checkPostExecutionBudget(output.usage.totalTokens, costUSD);
    const tokens = { prompt: output.usage.promptTokens, completion: output.usage.completionTokens, total: output.usage.totalTokens };
    const result: ExecutionResult = {
      text: sanitizedText,
      tokens,
      costUSD,
      modelUsed: output.modelUsed,
      failoverOccurred: output.failoverOccurred,
      attempts: output.attempts,
    };
    await this.notifyAuditSink(result);
    return result;
  };

  private runAfterHooks = async (
    beforeState: { messages: ChatMessage[]; metadata?: Record<string, unknown> },
    output: ProviderDispatchOutput
  ) => {
    const tokens = { prompt: output.usage.promptTokens, completion: output.usage.completionTokens, total: output.usage.totalTokens };
    const costUSD = this.calculateCost(output.modelUsed, output.usage.promptTokens, output.usage.completionTokens);
    return executeAfterResponseHooks(
      this.config.middlewares,
      {
        messages: beforeState.messages,
        responseText: output.responseText,
        modelUsed: output.modelUsed,
        tokens,
        costUSD,
        attempts: output.attempts,
        failoverOccurred: output.failoverOccurred,
        metadata: beforeState.metadata,
      },
      this.config.middlewareTimeoutMs ?? 5000
    );
  };

  private verifyPromptBudget = async (
    messages: ChatMessage[],
    model: string,
    parentRunId?: string
  ): Promise<BudgetReservation | undefined> => {
    const promptLength = messages.reduce((sum, msg) => sum + msg.content.length, 0);
    const estimatedPromptTokens = Math.ceil(promptLength / 4);
    return this.checkPreflightBudget(estimatedPromptTokens, model, undefined, parentRunId);
  };

  execute = async (options: {
    userQuery?: string;
    systemPrompt?: string;
    messages?: ChatMessage[];
    temperature?: number;
    providerOverride?: LLMProviderPort;
    metadata?: Record<string, unknown>;
  }): Promise<ExecutionResult> => {
    const inputMessages = this.prepareInputMessages(options);
    const beforeState = await executeBeforeRequestHooks(
      this.config.middlewares,
      {
        messages: inputMessages,
        model: this.config.primary.model,
        temperature: options.temperature,
        metadata: options.metadata,
      },
      this.config.middlewareTimeoutMs ?? 5000
    );
    if (beforeState.shortCircuit) {
      return this.handleShortCircuit(beforeState.shortCircuit, this.config.primary.model);
    }
    beforeState.messages = this.reScanMessagesAfterHooks(inputMessages, beforeState.messages);
    const parentRunId = (beforeState.metadata?.parentRunId ?? options.metadata?.parentRunId) as string | undefined;
    const reservation = await this.verifyPromptBudget(beforeState.messages, this.config.primary.model, parentRunId);

    let output: ProviderDispatchOutput;
    try {
      output = await this.dispatchPromptExecution(beforeState.messages, options.temperature, options.providerOverride);
    } catch (err: unknown) {
      if (reservation) {
        const errorMsg = String(err);
        const isClientError = errorMsg.includes("HTTP 400") || errorMsg.includes("HTTP 401") || errorMsg.includes("HTTP 403") || errorMsg.includes("HTTP 422");
        if (isClientError) {
          reservation.status = "RELEASED";
          reservation.updatedAt = Date.now();
        } else {
          reservation.status = "UNCONFIRMED_TIMEOUT";
          reservation.updatedAt = Date.now();
        }
      }
      throw err;
    }

    const afterState = await this.runAfterHooks(beforeState, output);
    const finalResult = await this.finalizeExecutionResult(output, afterState.responseText);

    if (reservation) {
      reservation.status = "SETTLED";
      reservation.settledCostUsd = finalResult.costUSD;
      reservation.updatedAt = Date.now();
    }

    return finalResult;
  };


  executePrompt = this.execute;



  executeStructured = async <T>(options: {
    userQuery: string;
    systemPrompt?: string;
    schema: z.ZodType<T>;
    temperature?: number;
    providerOverride?: LLMProviderPort;
  }): Promise<StructuredExecutionResult<T>> => {
    const rawResult = await this.execute({
      userQuery: options.userQuery,
      systemPrompt: options.systemPrompt,
      temperature: options.temperature ?? 0.1,
      providerOverride: options.providerOverride,
    });

    const isFinancial = Boolean(
      this.config.features?.finance?.enableFrenchAccounting || this.config.features?.finance
    );

    const parsedData = validateWithZod(rawResult.text, options.schema, {
      financialNormalizer: isFinancial,
      jurisdiction: this.config.features?.finance?.jurisdiction,
    });

    return {
      data: parsedData,
      rawText: rawResult.text,
      tokens: rawResult.tokens,
      costUSD: rawResult.costUSD,
      modelUsed: rawResult.modelUsed,
      failoverOccurred: rawResult.failoverOccurred,
    };
  };

  private sanitizeIncomingMessages = (messages: ChatMessage[]): ChatMessage[] => {
    return messages.map((msg) => {
      if (msg.role === "user") {
        return { ...msg, content: this.applySecurityGuards(msg.content) };
      }
      return msg;
    });
  };


  private dispatchOverrideAttempt = async (
    override: LLMProviderPort,
    messages: ChatMessage[],
    model: string,
    temperature?: number
  ) => {
    const res = await override.complete({ model, messages, temperature: temperature ?? 0.1 });
    const usage = this.resolveTokens(res.usage, JSON.stringify(messages), res.text);
    return {
      responseText: res.text,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      modelUsed: model,
      failoverOccurred: false,
    };
  };

  private dispatchSimulatedAttempt = (
    messages: ChatMessage[],
    modelOverride?: string
  ) => {
    if (!this.config.mockSimulation) {
      throw new ConfigurationError(
        "[AvantGate Configuration Error] No active LLM provider configured. Provide a client implementing LLMProviderPort or configure credentials (apiKey / baseUrl)."
      );
    }
    const sim = this.executeSimulation(JSON.stringify(messages), undefined, modelOverride);
    const responseText = sim.text.includes("{")
      ? sim.text
      : JSON.stringify({ simulation: true, model: sim.modelUsed });

    return {
      responseText,
      promptTokens: sim.tokens.prompt,
      completionTokens: sim.tokens.completion,
      modelUsed: sim.modelUsed,
      failoverOccurred: false,
    };
  };

  private dispatchPipelineAttempt = async (
    messages: ChatMessage[],
    modelOverride?: string,
    temperature?: number
  ) => {
    const output = await this.executeProviderPipeline(
      messages,
      JSON.stringify(messages),
      temperature ?? 0.1,
      modelOverride
    );
    return {
      responseText: output.responseText,
      promptTokens: output.usage.promptTokens,
      completionTokens: output.usage.completionTokens,
      modelUsed: output.modelUsed,
      failoverOccurred: output.failoverOccurred,
    };
  };

  private dispatchProviderAttempt = async <T>(
    options: GenerateStructuredOutputOptions<T>,
    messages: ChatMessage[],
    targetModel: string
  ) => {
    if (options.providerOverride) {
      return this.dispatchOverrideAttempt(options.providerOverride, messages, targetModel, options.temperature);
    }
    if (this.getProviderChain().length === 0) {
      return this.dispatchSimulatedAttempt(messages, options.model);
    }
    return this.dispatchPipelineAttempt(messages, options.model ?? targetModel, options.temperature);
  };

  private parseAndValidateStructuredResult = <T>(
    rawText: string,
    options: GenerateStructuredOutputOptions<T>
  ): { parsedData: T; sanitizedResponse: string } => {
    const sanitizedResponse = this.applyOutputSecurityGuards(rawText);
    const isFinancial =
      options.financialNormalizer ??
      Boolean(
        this.config.features?.finance?.enableFrenchAccounting || this.config.features?.finance
      );

    const parsedData = validateWithZod(sanitizedResponse, options.schema, {
      financialNormalizer: isFinancial,
      jurisdiction: this.config.features?.finance?.jurisdiction,
    });

    return { parsedData, sanitizedResponse };
  };

  private buildStructuredResult = <T>(params: {
    data: T;
    rawText: string;
    promptTokens: number;
    completionTokens: number;
    modelUsed: string;
    failoverOccurred: boolean;
  }): StructuredExecutionResult<T> => {
    const totalTokens = params.promptTokens + params.completionTokens;
    const costUSD = this.calculateCost(params.modelUsed, params.promptTokens, params.completionTokens);
    this.checkPostExecutionBudget(totalTokens, costUSD);

    return {
      data: params.data,
      rawText: params.rawText,
      tokens: {
        prompt: params.promptTokens,
        completion: params.completionTokens,
        total: totalTokens,
      },
      costUSD,
      modelUsed: params.modelUsed,
      failoverOccurred: params.failoverOccurred,
    };
  };

  private notifyAuditSinkSafe = async <T>(
    sanitizedText: string,
    result: StructuredExecutionResult<T>,
    attempts: number
  ): Promise<void> => {
    await this.notifyAuditSink({
      text: sanitizedText,
      tokens: result.tokens,
      costUSD: result.costUSD,
      modelUsed: result.modelUsed,
      failoverOccurred: result.failoverOccurred,
      attempts,
    });
  };

  private waitRetryBackoff = async (attempt: number, maxRetries: number): Promise<void> => {
    if (attempt >= maxRetries) {
      return;
    }
    const initialDelay = this.config.retryOptions?.initialDelayMs ?? 200;
    const factor = this.config.retryOptions?.backoffFactor ?? 1.5;
    const delay = initialDelay * Math.pow(factor, attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  };

  private handleStructuredShortCircuit = async <T>(
    shortCircuit: NonNullable<BeforeRequestResult["shortCircuit"]>,
    options: GenerateStructuredOutputOptions<T>,
    targetModel: string
  ): Promise<StructuredExecutionResult<T>> => {
    const { parsedData, sanitizedResponse } = this.parseAndValidateStructuredResult(
      shortCircuit.text,
      options
    );
    const tokens = {
      prompt: shortCircuit.tokens?.promptTokens ?? 0,
      completion: shortCircuit.tokens?.completionTokens ?? 0,
      total: shortCircuit.tokens?.totalTokens ?? 0,
    };
    const result: StructuredExecutionResult<T> = {
      data: parsedData,
      rawText: sanitizedResponse,
      tokens,
      costUSD: shortCircuit.costUSD ?? 0,
      modelUsed: `${targetModel}:shortcircuit`,
      failoverOccurred: false,
    };
    await this.notifyAuditSinkSafe(sanitizedResponse, result, 0);
    return result;
  };

  private runStructuredAfterHooks = async (
    messages: ChatMessage[],
    output: { responseText: string; modelUsed: string; promptTokens: number; completionTokens: number; failoverOccurred: boolean },
    attempt: number
  ) => {
    const tokens = { prompt: output.promptTokens, completion: output.completionTokens, total: output.promptTokens + output.completionTokens };
    const costUSD = this.calculateCost(output.modelUsed, output.promptTokens, output.completionTokens);
    return executeAfterResponseHooks(
      this.config.middlewares,
      {
        messages,
        responseText: output.responseText,
        modelUsed: output.modelUsed,
        tokens,
        costUSD,
        attempts: attempt,
        failoverOccurred: output.failoverOccurred,
      },
      this.config.middlewareTimeoutMs ?? 5000
    );
  };

  private executeStructuredLoop = async <T>(
    options: GenerateStructuredOutputOptions<T>,
    messages: ChatMessage[],
    targetModel: string,
    maxRetries: number
  ): Promise<StructuredExecutionResult<T>> => {
    let lastError: unknown;
    let accPrompt = 0;
    let accComp = 0;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const output = await this.dispatchProviderAttempt(options, messages, targetModel);
        accPrompt += output.promptTokens;
        accComp += output.completionTokens;
        const afterState = await this.runStructuredAfterHooks(messages, output, attempt + 1);
        const { parsedData, sanitizedResponse } = this.parseAndValidateStructuredResult(afterState.responseText, options);
        const result = this.buildStructuredResult({
          data: parsedData,
          rawText: sanitizedResponse,
          promptTokens: accPrompt,
          completionTokens: accComp,
          modelUsed: output.modelUsed,
          failoverOccurred: output.failoverOccurred,
        });
        await this.notifyAuditSinkSafe(sanitizedResponse, result, attempt + 1);
        return result;
      } catch (err) {
        lastError = err;
        await this.waitRetryBackoff(attempt, maxRetries);
      }
    }
    throw lastError;
  };

  generateStructuredOutput = async <T>(
    options: GenerateStructuredOutputOptions<T>
  ): Promise<StructuredExecutionResult<T>> => {
    const maxRetries = options.maxRetries ?? this.config.retryOptions?.maxRetries ?? 2;
    const targetModel = options.model ?? this.config.primary.model;
    const processedMessages = this.sanitizeIncomingMessages(options.messages);

    const beforeState = await executeBeforeRequestHooks(
      this.config.middlewares,
      {
        messages: processedMessages,
        model: targetModel,
        temperature: options.temperature,
      },
      this.config.middlewareTimeoutMs ?? 5000
    );

    if (beforeState.shortCircuit) {
      return this.handleStructuredShortCircuit(beforeState.shortCircuit, options, targetModel);
    }

    beforeState.messages = this.reScanMessagesAfterHooks(processedMessages, beforeState.messages);

    const reservation = await this.verifyPromptBudget(beforeState.messages, targetModel);
    try {
      const result = await this.executeStructuredLoop(options, beforeState.messages, targetModel, maxRetries);
      if (reservation) {
        reservation.status = "SETTLED";
        reservation.settledCostUsd = result.costUSD;
        reservation.updatedAt = Date.now();
      }
      return result;
    } catch (err: unknown) {
      if (reservation) {
        const errorMsg = String(err);
        const isClientError = errorMsg.includes("HTTP 400") || errorMsg.includes("HTTP 401") || errorMsg.includes("HTTP 403") || errorMsg.includes("HTTP 422");
        if (isClientError) {
          reservation.status = "RELEASED";
          reservation.updatedAt = Date.now();
        } else {
          reservation.status = "UNCONFIRMED_TIMEOUT";
          reservation.updatedAt = Date.now();
        }
      }
      throw err;
    }
  };
}

export const createLLMControlLayer = (config: ControlLayerConfig): AvantGateControlLayer => {
  return new AvantGateControlLayer(config);
};

export const createAvantGate = createLLMControlLayer;
export { AvantGateControlLayer as ZenLLMControlLayer };
