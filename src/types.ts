import { z } from "zod";

export const ChatRoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export type ChatRole = z.infer<typeof ChatRoleSchema>;

export const ChatMessageSchema = z.object({
  role: ChatRoleSchema,
  content: z.string().min(1, "Message content cannot be empty"),
}).strict();

export const ChatMessagesArraySchema = z.array(ChatMessageSchema);
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

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

export class ProviderTTFTTimeoutError extends Error {
  readonly ttftTimeoutMs: number;
  constructor(message: string, ttftTimeoutMs: number) {
    super(message);
    this.name = "ProviderTTFTTimeoutError";
    this.ttftTimeoutMs = ttftTimeoutMs;
  }
}

export class ProviderIdleTimeoutError extends Error {
  readonly idleTimeoutMs: number;
  constructor(message: string, idleTimeoutMs: number) {
    super(message);
    this.name = "ProviderIdleTimeoutError";
    this.idleTimeoutMs = idleTimeoutMs;
  }
}

export type BudgetReservationStatus = "RESERVED" | "SETTLED" | "RELEASED" | "UNCONFIRMED_TIMEOUT";

export interface BudgetReservation {
  id: string;
  tenantId?: string;
  parentRunId?: string;
  estimatedCostUsd: number;
  settledCostUsd?: number;
  status: BudgetReservationStatus;
  createdAt: number;
  updatedAt: number;
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
  ttftTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export type TermCategory = "PROJECT" | "COMPANY" | "INFRA" | "CUSTOM";

export interface CustomRedactionTermDef {
  id?: string;
  term: string;
  mask?: string;
  category?: TermCategory;
  caseSensitive?: boolean;
}

export interface SecurityConfig {
  detectPromptInjection?: boolean;
  maskPII?: boolean;
  maxInputLength?: number;
  outputDLP?: boolean;
  blockSecretLeaks?: boolean;
  secretLeakAction?: "REDACT" | "BLOCK";
  customRedactionTerms?: Array<string | CustomRedactionTermDef>;
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

export interface BeforeRequestContext {
  messages: readonly ChatMessage[];
  model: string;
  temperature?: number;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface BeforeRequestResult {
  messages?: ChatMessage[];
  shortCircuit?: {
    text: string;
    tokens?: LLMUsage;
    costUSD?: number;
  };
}

export interface AfterResponseContext {
  messages: readonly ChatMessage[];
  responseText: string;
  modelUsed: string;
  tokens: { prompt: number; completion: number; total: number };
  costUSD: number;
  attempts: number;
  failoverOccurred: boolean;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface AfterResponseResult {
  responseText?: string;
  metadata?: Record<string, unknown>;
}

export interface AvantGateMiddleware {
  name: string;
  beforeRequest?: (context: BeforeRequestContext) => Promise<BeforeRequestResult | void> | BeforeRequestResult | void;
  afterResponse?: (context: AfterResponseContext) => Promise<AfterResponseResult | void> | AfterResponseResult | void;
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
  middlewares?: AvantGateMiddleware[];
  middlewareTimeoutMs?: number;
  reScanIngressAfterHooks?: boolean;
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

