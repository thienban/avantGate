import type {
  LLMProviderPort,
  LLMCompletionOptions,
  LLMUsage,
  ChatMessage,
  ProviderConfig,
} from "../types";

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

  constructor(config: ProviderConfig) {
    this.providerType = config.provider;
    this.name = `${config.provider}-http`;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URLS[config.provider] || "https://api.openai.com/v1";
  }

  private resolveEndpoint(): string {
    const trimmed = this.baseUrl.replace(/\/+$/, "");
    if (trimmed.endsWith("/chat/completions")) {
      return trimmed;
    }
    return `${trimmed}/chat/completions`;
  }

  private buildHeaders(): Record<string, string> {
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
  }

  private buildPayload(options: LLMCompletionOptions, model: string) {
    return {
      model,
      messages: options.messages.map((m: ChatMessage) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: options.temperature ?? 0.2,
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
    };
  }

  private extractUsage(usageData?: OpenAIChatResponse["usage"]): LLMUsage | undefined {
    if (!usageData) {
      return undefined;
    }
    return {
      promptTokens: usageData.prompt_tokens,
      completionTokens: usageData.completion_tokens,
      totalTokens: usageData.total_tokens,
      promptCacheHitTokens: usageData.prompt_tokens_details?.cached_tokens,
    };
  }

  async complete(options: LLMCompletionOptions): Promise<{ text: string; usage?: LLMUsage }> {
    const endpoint = this.resolveEndpoint();
    const model = options.model ?? "default";
    const headers = this.buildHeaders();
    const body = JSON.stringify(this.buildPayload(options, model));

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `[AvantGate HTTP Provider ${this.providerType}] HTTP ${response.status} ${response.statusText}: ${errorText}`
      );
    }

    const data = (await response.json()) as OpenAIChatResponse;
    const text = data.choices?.[0]?.message?.content ?? "";
    const usage = this.extractUsage(data.usage);

    return { text, usage };
  }
}

export function createHttpProviderClient(config: ProviderConfig): HttpProviderClient {
  return new HttpProviderClient(config);
}
