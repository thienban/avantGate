import { z } from "zod";
import type {
  ControlLayerConfig,
  ExecutionResult,
  StructuredExecutionResult,
  LLMProviderPort,
  ChatMessage,
  ProviderConfig,
  LLMUsage,
} from "./types";
import { validateUserInput } from "./input-guard";
import { sanitizePII } from "./sanitizer";
import { calculateCostUSD } from "./pricing";
import { validateWithZod } from "./response-validator";

interface ProviderDispatchOutput {
  responseText: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  modelUsed: string;
  failoverOccurred: boolean;
  attempts: number;
}

export class AvantGateControlLayer {
  private config: ControlLayerConfig;

  constructor(config: ControlLayerConfig) {
    this.config = config;
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
    return { promptTokens, completionTokens, totalTokens };
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
    const cost = calculateCostUSD(this.config.primary.model, promptTokens, completionTokens);

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
    temperature?: number
  ): Promise<ProviderDispatchOutput> {
    const chain = this.getProviderChain();
    let lastError: unknown;

    for (let index = 0; index < chain.length; index++) {
      const providerConfig = chain[index];
      try {
        const response = await providerConfig.client!.complete({
          model: providerConfig.model,
          messages,
          temperature: temperature ?? 0.2,
        });
        const usage = this.resolveTokens(response.usage, query, response.text);
        return {
          responseText: response.text,
          usage,
          modelUsed: providerConfig.model,
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
    const costUSD = calculateCostUSD(
      output.modelUsed,
      output.usage.promptTokens,
      output.usage.completionTokens
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
   * Exécute une requête avec garde d'entrée, masquage PII, et calcul des coûts.
   */
  async execute(options: {
    userQuery: string;
    systemPrompt?: string;
    temperature?: number;
    providerOverride?: LLMProviderPort;
  }): Promise<ExecutionResult> {
    const sanitizedQuery = this.applySecurityGuards(options.userQuery);
    const messages = this.buildMessages(options.systemPrompt, sanitizedQuery);

    if (!options.providerOverride && this.getProviderChain().length === 0) {
      const simResult = this.executeSimulation(sanitizedQuery, options.systemPrompt);
      await this.notifyAuditSink(simResult);
      return simResult;
    }

    const output = options.providerOverride
      ? await this.executeOverrideProvider(options.providerOverride, messages, sanitizedQuery, options.temperature)
      : await this.executeProviderPipeline(messages, sanitizedQuery, options.temperature);

    const result = this.assembleResult(output);
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

    const parsedData = validateWithZod(rawResult.text, options.schema);

    return {
      data: parsedData,
      rawText: rawResult.text,
      tokens: rawResult.tokens,
      costUSD: rawResult.costUSD,
      modelUsed: rawResult.modelUsed,
      failoverOccurred: rawResult.failoverOccurred,
    };
  }
}

export function createLLMControlLayer(config: ControlLayerConfig): AvantGateControlLayer {
  return new AvantGateControlLayer(config);
}

export const createAvantGate = createLLMControlLayer;
export { AvantGateControlLayer as ZenLLMControlLayer };
