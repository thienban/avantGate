import { z } from "zod";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface LLMUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
}

export interface LLMCompletionOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  responseFormat?: Record<string, unknown>;
}

export interface LLMStructuredOutputOptions<T> {
  model?: string;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  schemaName: string;
  temperature?: number;
}

export interface LLMProviderPort {
  readonly name: string;
  complete(options: LLMCompletionOptions): Promise<{ text: string; usage?: LLMUsage }>;
  stream?(options: LLMCompletionOptions): AsyncGenerator<string, LLMUsage | undefined>;
  generateStructuredOutput?<T>(options: LLMStructuredOutputOptions<T>): Promise<T>;
}

export interface ProviderConfig {
  provider: "deepseek" | "mistral" | "openai" | "ollama" | "openrouter" | "custom";
  model: string;
  apiKey?: string;
  baseUrl?: string;
  client?: LLMProviderPort;
}

export interface SecurityConfig {
  detectPromptInjection?: boolean;
  maskPII?: boolean;
  maxInputLength?: number;
}

export interface RetryConfig {
  maxRetries?: number;
  initialDelayMs?: number;
  backoffFactor?: number;
}

export interface AuditRecord {
  timestamp: Date;
  model: string;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  costUSD: number;
  failoverOccurred: boolean;
  attempts: number;
  durationMs?: number;
}

export interface AuditSinkPort {
  readonly name: string;
  log(record: AuditRecord): Promise<void> | void;
}

export interface ControlLayerConfig {
  primary: ProviderConfig;
  fallback?: ProviderConfig;
  emergencyFallback?: ProviderConfig;
  retryOptions?: RetryConfig;
  auditSink?: AuditSinkPort;
  maxTokenBudget?: number;
  maxCostUSD?: number;
  security?: SecurityConfig;
  hourlyTokenLimit?: number;
  dailyTokenLimit?: number;
}

export interface ExecutionResult {
  text: string;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  costUSD: number;
  modelUsed: string;
  failoverOccurred: boolean;
  attempts: number;
}

export interface StructuredExecutionResult<T> {
  data: T;
  rawText: string;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  costUSD: number;
  modelUsed: string;
  failoverOccurred: boolean;
}
