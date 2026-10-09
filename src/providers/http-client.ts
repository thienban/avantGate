import type {
  LLMProviderPort,
  LLMCompletionOptions,
  LLMUsage,
  ChatMessage,
  ProviderConfig,
} from "../types";
import { ProviderTTFTTimeoutError, ProviderIdleTimeoutError } from "../types";

const DEFAULT_BASE_URLS: Record<string, string> = {
  deepseek: "https://api.deepseek.com/v1",
  mistral: "https://api.mistral.ai/v1",
  openai: "https://api.openai.com/v1",
  ollama: "http://localhost:11434/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
    delta?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_tokens_details?: {
      cached_tokens?: number;
    };
  };
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
  };
}

export class HttpProviderClient implements LLMProviderPort {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly providerType: string;
  private readonly ttftTimeoutMs: number;
  private readonly idleTimeoutMs: number;

  constructor(config: ProviderConfig) {
    this.providerType = config.provider;
    this.name = `${config.provider}-http`;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URLS[config.provider] || "https://api.openai.com/v1";
    this.ttftTimeoutMs = config.ttftTimeoutMs ?? 15000;
    this.idleTimeoutMs = config.idleTimeoutMs ?? 5000;
  }

  private resolveEndpoint = (): string => {
    const trimmed = this.baseUrl.replace(/\/+$/, "");
    if (trimmed.endsWith("/chat/completions")) {
      return trimmed;
    }
    return `${trimmed}/chat/completions`;
  };

  private buildHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    if (this.providerType === "openrouter") {
      headers["HTTP-Referer"] = "https://avantgate.dev";
      headers["X-Title"] = "AvantGate";
    }

    return headers;
  };

  private buildPayload = (options: LLMCompletionOptions, model: string, stream: boolean = false) => {
    return {
      model,
      messages: options.messages.map((m: ChatMessage) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: options.temperature ?? 0.2,
      stream,
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    };
  };

  private extractUsage = (usageData?: OpenAIChatResponse["usage"]): LLMUsage | undefined => {
    if (!usageData) {
      return undefined;
    }
    return {
      promptTokens: usageData.prompt_tokens,
      completionTokens: usageData.completion_tokens,
      totalTokens: usageData.total_tokens,
      promptCacheHitTokens: usageData.prompt_tokens_details?.cached_tokens,
    };
  };

  private readStreamWithHeartbeat = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    controller: AbortController
  ): Promise<string> => {
    const decoder = new TextDecoder();
    let accumulatedText = "";
    let isFirstTokenReceived = false;

    // Timeout initial pour le premier token (TTFT)
    let activeTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
      controller.abort();
    }, this.ttftTimeoutMs);

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (controller.signal.aborted) {
          throw new Error("Aborted");
        }

        if (done) {
          if (activeTimer) clearTimeout(activeTimer);
          break;
        }

        // Dès qu'on reçoit des données valides
        if (value && value.length > 0) {
          if (activeTimer) clearTimeout(activeTimer);

          if (!isFirstTokenReceived) {
            isFirstTokenReceived = true;
          }

          // Armer le timeout d'inactivité entre paquets (Idle Read Timeout)
          activeTimer = setTimeout(() => {
            controller.abort();
            reader.cancel().catch(() => {});
          }, this.idleTimeoutMs);

          accumulatedText += decoder.decode(value, { stream: true });
        }
      }
    } catch (err: unknown) {
      if (controller.signal.aborted) {
        if (!isFirstTokenReceived) {
          throw new ProviderTTFTTimeoutError(
            `[AvantGate HTTP Provider ${this.providerType}] Time-to-First-Token (TTFT) timeout of ${this.ttftTimeoutMs}ms exceeded without receiving initial response bytes.`,
            this.ttftTimeoutMs
          );
        }
        throw new ProviderIdleTimeoutError(
          `[AvantGate HTTP Provider ${this.providerType}] Idle read timeout of ${this.idleTimeoutMs}ms exceeded during stream generation.`,
          this.idleTimeoutMs
        );
      }
      throw err;
    } finally {
      if (activeTimer) clearTimeout(activeTimer);
    }

    return accumulatedText;
  };

  complete = async (options: LLMCompletionOptions): Promise<{ text: string; usage?: LLMUsage }> => {
    const endpoint = this.resolveEndpoint();
    const model = options.model ?? "default";
    const headers = this.buildHeaders();
    const body = JSON.stringify(this.buildPayload(options, model));

    const abortController = new AbortController();

    // TTFT timer initial
    const ttftTimer = setTimeout(() => {
      abortController.abort();
    }, this.ttftTimeoutMs);

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body,
        signal: abortController.signal,
      });
    } catch (err: unknown) {
      if (abortController.signal.aborted) {
        throw new ProviderTTFTTimeoutError(
          `[AvantGate HTTP Provider ${this.providerType}] Time-to-First-Token (TTFT) timeout of ${this.ttftTimeoutMs}ms exceeded before receiving headers.`,
          this.ttftTimeoutMs
        );
      }
      throw err;
    } finally {
      clearTimeout(ttftTimer);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[AvantGate HTTP Provider ${this.providerType}] HTTP ${response.status} ${response.statusText}: ${errorText}`
      );
    }

    // Si un corps de flux ReadableStream est disponible, on lit avec idle timeout
    if (response.body) {
      const reader = response.body.getReader();
      const rawText = await this.readStreamWithHeartbeat(reader, abortController);
      try {
        const data = JSON.parse(rawText) as OpenAIChatResponse;
        const text = data.choices?.[0]?.message?.content ?? "";
        const usage = this.extractUsage(data.usage);
        return { text, usage };
      } catch {
        return { text: rawText };
      }
    }

    const data = (await response.json()) as OpenAIChatResponse;
    const text = data.choices?.[0]?.message?.content ?? "";
    const usage = this.extractUsage(data.usage);

    return { text, usage };
  };
}

export const createHttpProviderClient = (config: ProviderConfig): HttpProviderClient => {
  return new HttpProviderClient(config);
};

