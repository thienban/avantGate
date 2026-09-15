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
} from "./types";
import { ConfigurationError, BudgetExceededError } from "./types";
import { validateUserInput } from "./input-guard";
import { sanitizePII } from "./sanitizer";
import { calculateCostUSD, CachedPricingAdapter, resolveModelPrice } from "./pricing";
import { validateWithZod } from "./response-validator";
import { createHttpProviderClient } from "./providers/http-client";

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

  constructor(config: ControlLayerConfig) {
    this.config = {
      ...config,
      primary: this.resolveProviderConfig(config.primary)!,
      fallback: this.resolveProviderConfig(config.fallback),
      emergencyFallback: this.resolveProviderConfig(config.emergencyFallback),
    };

    if (config.pricingAdapter) {
      this.cachedPricingAdapter = new CachedPricingAdapter(
        config.pricingAdapter,
        config.pricingCacheTtlMs ?? 5 * 60 * 1000
      );
    }
  }

  private resolveProviderConfig(provider?: ProviderConfig): ProviderConfig | undefined {
    if (!provider) return undefined;
    if (provider.client) return provider;
    if (provider.apiKey || provider.baseUrl || provider.provider === "ollama") {
      return {
        ...provider,
        client: createHttpProviderClient(provider),
      };
    }
    return provider;
  }

  private findProviderConfig(provider?: string, model?: string): ProviderConfig | undefined {
    const list = [this.config.primary, this.config.fallback, this.config.emergencyFallback].filter(
      (p): p is ProviderConfig => Boolean(p)
    );
    if (provider) {
      const matchProvider = list.find((p) => p.provider === provider);
      if (matchProvider) return matchProvider;
    }
    if (model) {
      const matchModel = list.find((p) => p.model === model);
      if (matchModel) return matchModel;
    }
    return this.config.primary;
  }

  private calculateCost(
    model: string,
    promptTokens: number,
    completionTokens: number,
    cacheHitTokens: number = 0,
    provider?: string
  ): number {
    const providerCfg = this.findProviderConfig(provider, model);
    return calculateCostUSD(model, promptTokens, completionTokens, cacheHitTokens, {
      provider: provider ?? providerCfg?.provider,
      providerPricing: providerCfg?.pricing,
      customPricing: this.config.customPricing,
      adapter: this.cachedPricingAdapter,
    });
  }

  private applySecurityGuards(userQuery: string): string {
    const guard = validateUserInput(userQuery, {
      detectInjection: this.config.security?.detectPromptInjection,
      maxLength: this.config.security?.maxInputLength,
    });

    if (!guard.valid) {
      throw new Error(`[AvantGate Security Guard] Request blocked: ${guard.blockedReason}`);
    }

    if (this.config.security?.maskPII) {
      return sanitizePII(userQuery).text;
    }

    return userQuery;
  }

  private checkPreflightBudget(estimatedPromptTokens: number, targetModel: string, provider?: string): void {
    if (this.config.maxTokenBudget !== undefined && estimatedPromptTokens > this.config.maxTokenBudget) {
      throw new BudgetExceededError(
        `[AvantGate Budget Guard] Pre-flight token budget exceeded: estimated prompt (${estimatedPromptTokens} tokens) exceeds maxTokenBudget (${this.config.maxTokenBudget}).`
      );
    }

    if (this.config.maxCostUSD !== undefined) {
      const isLocalFree = provider === "ollama" || targetModel.toLowerCase().includes("ollama");
      const providerCfg = this.findProviderConfig(provider, targetModel);
      const price = resolveModelPrice(targetModel, {
        provider: provider ?? providerCfg?.provider,
        providerPricing: providerCfg?.pricing,
        customPricing: this.config.customPricing,
        adapter: this.cachedPricingAdapter,
      });

      if (!isLocalFree && !price) {
        throw new ConfigurationError(
          `[AvantGate Configuration Error] 'maxCostUSD' was set to $${this.config.maxCostUSD}, but no pricing was configured for model '${targetModel}'. Please define pricing in ProviderConfig, customPricing, or via PricingAdapter.`
        );
      }

      const estimatedPromptCost = this.calculateCost(targetModel, estimatedPromptTokens, 0, 0, provider);
      if (estimatedPromptCost > this.config.maxCostUSD) {
        throw new BudgetExceededError(
          `[AvantGate Budget Guard] Pre-flight cost budget exceeded: estimated prompt cost ($${estimatedPromptCost.toFixed(6)}) exceeds maxCostUSD ($${this.config.maxCostUSD}).`
        );
      }
    }
  }

  private checkPostExecutionBudget(tokensTotal: number, costUSD: number): void {
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
  }

  private buildMessages(systemPrompt: string | undefined, query: string): ChatMessage[] {
    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: query });
    return messages;
  }

  private resolveTokens(rawUsage: LLMUsage | undefined, query: string, text: string) {
    const promptTokens = rawUsage?.promptTokens ?? Math.ceil(query.length / 4);
    const completionTokens = rawUsage?.completionTokens ?? Math.ceil(text.length / 4);
    const totalTokens = rawUsage?.totalTokens ?? promptTokens + completionTokens;
    return {
      promptTokens,
      completionTokens,
      totalTokens,
      promptCacheHitTokens: rawUsage?.promptCacheHitTokens,
    };
  }

  private getProviderChain(): ProviderConfig[] {
    return [
      this.config.primary,
      this.config.fallback,
      this.config.emergencyFallback,
    ].filter((provider): provider is ProviderConfig => Boolean(provider?.client));
  }

  private executeSimulation(query: string, systemPrompt?: string): ExecutionResult {
    const promptTokens = Math.ceil(((systemPrompt?.length ?? 0) + query.length) / 4);
    const completionTokens = 50;
    const cost = this.calculateCost(this.config.primary.model, promptTokens, completionTokens);

    return {
      text: `[AvantGate In-Process Engine] Response simulation for model: ${this.config.primary.model}`,
      tokens: {
        prompt: promptTokens,
        completion: completionTokens,
        total: promptTokens + completionTokens,
      },
      costUSD: cost,
      modelUsed: this.config.primary.model,
      failoverOccurred: false,
      attempts: 1,
    };
  }

  private async executeOverrideProvider(
    provider: LLMProviderPort,
    messages: ChatMessage[],
    query: string,
    temperature?: number
  ): Promise<ProviderDispatchOutput> {
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
  }

  private async executeProviderPipeline(
    messages: ChatMessage[],
    query: string,
    temperature?: number,
    modelOverride?: string
  ): Promise<ProviderDispatchOutput> {
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
  }

  private assembleResult(output: ProviderDispatchOutput): ExecutionResult {
    const costUSD = this.calculateCost(
      output.modelUsed,
      output.usage.promptTokens,
      output.usage.completionTokens,
      output.usage.promptCacheHitTokens ?? 0
    );

    return {
      text: output.responseText,
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
  }

  private async notifyAuditSink(result: ExecutionResult): Promise<void> {
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
  }

  /**
   * Exécute une requête avec garde d'entrée, masquage PII, garde pré-vol et calcul des coûts.
   */
  async execute(options: {
    userQuery: string;
    systemPrompt?: string;
    temperature?: number;
    providerOverride?: LLMProviderPort;
  }): Promise<ExecutionResult> {
    const sanitizedQuery = this.applySecurityGuards(options.userQuery);
    const messages = this.buildMessages(options.systemPrompt, sanitizedQuery);

    const promptLength = (options.systemPrompt?.length ?? 0) + sanitizedQuery.length;
    const estimatedPromptTokens = Math.ceil(promptLength / 4);
    this.checkPreflightBudget(estimatedPromptTokens, this.config.primary.model, this.config.primary.provider);

    if (!options.providerOverride && this.getProviderChain().length === 0) {
      if (this.config.mockSimulation) {
        const simResult = this.executeSimulation(sanitizedQuery, options.systemPrompt);
        await this.notifyAuditSink(simResult);
        return simResult;
      }
      throw new ConfigurationError(
        "[AvantGate Configuration Error] No active LLM provider configured. Provide a client implementing LLMProviderPort or configure credentials (apiKey / baseUrl)."
      );
    }

    const output = options.providerOverride
      ? await this.executeOverrideProvider(options.providerOverride, messages, sanitizedQuery, options.temperature)
      : await this.executeProviderPipeline(messages, sanitizedQuery, options.temperature);

    const result = this.assembleResult(output);
    this.checkPostExecutionBudget(result.tokens.total, result.costUSD);
    await this.notifyAuditSink(result);
    return result;
  }

  /**
   * Exécute une requête et valide/répare le résultat selon un schéma Zod.
   */
  async executeStructured<T>(options: {
    userQuery: string;
    systemPrompt?: string;
    schema: z.ZodType<T>;
    temperature?: number;
    providerOverride?: LLMProviderPort;
  }): Promise<StructuredExecutionResult<T>> {
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
  }

  /**
   * Méthode unifiée de premier niveau pour l'extraction structurée sans code boilerplate.
   * Gère le failover multi-fournisseurs, les retries, la validation Zod et la normalisation financière.
   */
  async generateStructuredOutput<T>(
    options: GenerateStructuredOutputOptions<T>
  ): Promise<StructuredExecutionResult<T>> {
    const maxRetries = options.maxRetries ?? this.config.retryOptions?.maxRetries ?? 2;
    const modelToUse = options.model ?? this.config.primary.model;

    const processedMessages = options.messages.map((msg) => {
      if (msg.role === "user") {
        return { ...msg, content: this.applySecurityGuards(msg.content) };
      }
      return msg;
    });

    const promptLength = processedMessages.reduce((sum, msg) => sum + msg.content.length, 0);
    const estimatedPromptTokens = Math.ceil(promptLength / 4);
    this.checkPreflightBudget(estimatedPromptTokens, modelToUse);

    let lastError: unknown;
    let accumulatedPromptTokens = 0;
    let accumulatedCompletionTokens = 0;
    let failoverOccurred = false;
    let modelUsed = modelToUse;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        let responseText = "";
        let attemptPromptTokens = 0;
        let attemptCompletionTokens = 0;

        if (options.providerOverride) {
          const res = await options.providerOverride.complete({
            model: modelToUse,
            messages: processedMessages,
            temperature: options.temperature ?? 0.1,
          });
          responseText = res.text;
          const usage = this.resolveTokens(res.usage, JSON.stringify(processedMessages), responseText);
          attemptPromptTokens = usage.promptTokens;
          attemptCompletionTokens = usage.completionTokens;
          modelUsed = modelToUse;
        } else if (this.getProviderChain().length === 0) {
          if (this.config.mockSimulation) {
            const sim = this.executeSimulation(JSON.stringify(processedMessages));
            responseText = sim.text;
            attemptPromptTokens = sim.tokens.prompt;
            attemptCompletionTokens = sim.tokens.completion;
          } else {
            throw new ConfigurationError(
              "[AvantGate Configuration Error] No active LLM provider configured. Provide a client implementing LLMProviderPort or configure credentials (apiKey / baseUrl)."
            );
          }
        } else {
          const output = await this.executeProviderPipeline(
            processedMessages,
            JSON.stringify(processedMessages),
            options.temperature ?? 0.1,
            options.model
          );
          responseText = output.responseText;
          attemptPromptTokens = output.usage.promptTokens;
          attemptCompletionTokens = output.usage.completionTokens;
          modelUsed = output.modelUsed;
          failoverOccurred = output.failoverOccurred;
        }

        accumulatedPromptTokens += attemptPromptTokens;
        accumulatedCompletionTokens += attemptCompletionTokens;

        const isFinancial =
          options.financialNormalizer ??
          Boolean(
            this.config.features?.finance?.enableFrenchAccounting || this.config.features?.finance
          );

        const parsedData = validateWithZod(responseText, options.schema, {
          financialNormalizer: isFinancial,
          jurisdiction: this.config.features?.finance?.jurisdiction,
        });

        const totalTokens = accumulatedPromptTokens + accumulatedCompletionTokens;
        const costUSD = this.calculateCost(modelUsed, accumulatedPromptTokens, accumulatedCompletionTokens);

        this.checkPostExecutionBudget(totalTokens, costUSD);

        const result: StructuredExecutionResult<T> = {
          data: parsedData,
          rawText: responseText,
          tokens: {
            prompt: accumulatedPromptTokens,
            completion: accumulatedCompletionTokens,
            total: totalTokens,
          },
          costUSD,
          modelUsed,
          failoverOccurred,
        };

        await this.notifyAuditSink({
          text: responseText,
          tokens: result.tokens,
          costUSD: result.costUSD,
          modelUsed: result.modelUsed,
          failoverOccurred: result.failoverOccurred,
          attempts: attempt + 1,
        });

        return result;
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          const delay =
            (this.config.retryOptions?.initialDelayMs ?? 200) *
            Math.pow(this.config.retryOptions?.backoffFactor ?? 1.5, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }
}

export function createLLMControlLayer(config: ControlLayerConfig): AvantGateControlLayer {
  return new AvantGateControlLayer(config);
}

export const createAvantGate = createLLMControlLayer;
export { AvantGateControlLayer as ZenLLMControlLayer };
