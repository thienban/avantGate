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

export interface ModelPrice {
  promptUSDPerMillion: number;
  completionUSDPerMillion: number;
  cacheHitUSDPerMillion?: number;
}

export interface PricingAdapter {
  fetchPrice(model: string, provider?: string): Promise<ModelPrice | undefined> | ModelPrice | undefined;
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

export class SecretLeakBlockedError extends Error {
  readonly detections?: Array<{ type: string; matchedCount: number }>;

  constructor(message: string, detections?: Array<{ type: string; matchedCount: number }>) {
    super(message);
    this.name = "SecretLeakBlockedError";
    this.detections = detections;
  }
}

export { ConfigurationError as AvantGateConfigurationError };
export { BudgetExceededError as AvantGateBudgetExceededError };
export { SecretLeakBlockedError as AvantGateSecretLeakBlockedError };

export interface ProviderConfig {
  provider: "deepseek" | "mistral" | "openai" | "ollama" | "openrouter" | "custom";
  model: string;
  apiKey?: string;
  baseUrl?: string;
  client?: LLMProviderPort;
  pricing?: ModelPrice;
}

export interface SecurityConfig {
  detectPromptInjection?: boolean;
  maskPII?: boolean;
  maxInputLength?: number;
  outputDLP?: boolean;
  blockSecretLeaks?: boolean;
  secretLeakAction?: "REDACT" | "BLOCK";
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

export interface FinanceFeaturesConfig {
  enableFrenchAccounting?: boolean;
  stripCurrencySymbols?: boolean;
  jurisdiction?: "FR" | "US" | "UK" | "CH" | "INTERNATIONAL";
  autoDetect?: boolean;
}

export interface FeaturesConfig {
  finance?: FinanceFeaturesConfig;
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
  features?: FeaturesConfig;
  pricingAdapter?: PricingAdapter;
  pricingCacheTtlMs?: number;
  customPricing?: Record<string, ModelPrice>;
  mockSimulation?: boolean;
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

export interface GenerateStructuredOutputOptions<T> {
  model?: string;
  messages: ChatMessage[];
  schema: z.ZodType<T>;
  schemaName?: string;
  maxRetries?: number;
  temperature?: number;
  providerOverride?: LLMProviderPort;
  financialNormalizer?: boolean;
}

