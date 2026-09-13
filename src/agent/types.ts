import type { z } from "zod";

/**
 * Lifecycle status for durable agent workflow steps.
 */
export type StepStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "WAITING_APPROVAL";

/**
 * Token usage metrics for LLM calls and tool executions.
 */
export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/**
 * Record representing a durable step stored in persistence.
 */
export interface StepRecord<TResult = unknown> {
  workflowId: string;
  stepId: string;
  runId?: string;
  status: StepStatus;
  result?: TResult;
  error?: string;
  piiDetectedCount?: number;
  tokens?: TokenUsage;
  costUsd?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Record representing a durable tool execution stored in persistence for hierarchical tracing.
 */
export interface ToolExecutionRecord {
  executionId: string;
  workflowId?: string;
  stepId?: string;
  runId?: string;
  toolId: string;
  parentToolId?: string;
  aliasUsed?: string;
  depth: number;
  inputArgs?: unknown;
  outputSummary?: unknown;
  durationMs: number;
  status: "SUCCESS" | "FAILED";
  error?: string;
  cached?: boolean;
  piiFilteredCount?: number;
  tokens?: TokenUsage;
  costUsd?: number;
  createdAt: string;
}

/**
 * Shared Blackboard state interface enabling inter-tool data exchange without context pollution.
 */
export interface ToolSharedState {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear?(): Promise<void>;
}

/**
 * Hexagonal Port Interface: Pure abstract storage contract.
 * Any storage backend (Prisma, Drizzle, Kysely, SQLite, Mongo, Redis, Supabase)
 * can plug into avantgate/agent by implementing this contract.
 */
export interface StepStorageAdapter {
  getStep<T = unknown>(workflowId: string, stepId: string): Promise<StepRecord<T> | null>;
  saveStep<T = unknown>(step: StepRecord<T>): Promise<void>;
  updateStepStatus<T = unknown>(
    workflowId: string,
    stepId: string,
    status: StepStatus,
    patch?: Partial<StepRecord<T>>
  ): Promise<void>;
  listSteps(workflowId: string): Promise<StepRecord[]>;

  // Optional ports for tool execution tracing, caching and blackboard memory
  saveToolExecution?(record: ToolExecutionRecord): Promise<void>;
  listToolExecutions?(workflowId?: string, stepId?: string): Promise<ToolExecutionRecord[]>;
  getCachedToolResult?<T = unknown>(cacheKey: string): Promise<T | null>;
  setCachedToolResult?<T = unknown>(cacheKey: string, result: T, ttlSeconds: number): Promise<void>;
  getStateValue?<T = unknown>(key: string): Promise<T | null>;
  setStateValue?<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  deleteStateValue?(key: string): Promise<void>;
  clearStateValues?(): Promise<void>;
}

/**
 * Options for step approval in Human-in-the-Loop workflows.
 */
export interface StepApprovalOptions<T = unknown> {
  prompt?: string;
  metadata?: Record<string, unknown>;
  defaultResult?: T;
}

/**
 * Execution context passed to workflow handlers.
 */
export interface StepRunnerContext {
  workflowId: string;
  run<T>(stepId: string, executeFn: () => Promise<T>): Promise<T>;
  waitForApproval<T = unknown>(
    stepId: string,
    options?: StepApprovalOptions<T>
  ): Promise<T>;
}

/**
 * Configuration options for creating a durable step runner.
 */
export interface StepRunnerConfig {
  workflowId: string;
  runId?: string;
  storage?: StepStorageAdapter;
}

/**
 * Context received by tool execution, supporting inter-tool chaining and shared state.
 */
export interface ToolExecutionContext {
  toolCallId?: string;
  messages?: unknown[];
  abortSignal?: AbortSignal;
  workflowId?: string;
  runId?: string;
  stepId?: string;
  callChain?: readonly string[];
  callTool?: <TResult = unknown>(toolId: string, args: unknown) => Promise<TResult>;
  state?: ToolSharedState;
  storage?: StepStorageAdapter;
  tokens?: TokenUsage;
  costUsd?: number;
  [key: string]: unknown;
}

/**
 * User and environment context injected into tools.
 */
export interface ToolContext {
  userId?: string;
  tenantId?: string;
  role?: string;
  phase?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Transformer converting raw tool result into a safe, minimal LLM message.
 */
export type LLMSummaryTransformer<TArgs = unknown, TResult = unknown> = (
  result: TResult,
  args: TArgs
) => unknown;

/**
 * Out-of-band callback streaming raw or rich tool data directly to the client UI.
 */
export type ClientDataCallback<TResult = unknown> = (
  data: TResult
) => void | Promise<void>;

/**
 * Configuration for creating an isolated tool with PII protection, Dual-Channel,
 * stable ID, aliasing and caching.
 */
export interface IsolatedToolConfig<TArgs = any, TResult = any> {
  id?: string;
  name: string;
  alias?: string;
  description: string;
  parameters: z.ZodType<TArgs> | unknown;
  cacheTTL?: number;
  execute: (args: TArgs, context?: ToolExecutionContext) => Promise<TResult>;
  toLLMSummary?: LLMSummaryTransformer<TArgs, TResult>;
  toClientData?: ClientDataCallback<TResult>;
  sanitizePii?: boolean;
  throwOnPii?: boolean;
}

/**
 * Standard tool contract compatible with Vercel AI SDK (ai) tool definition.
 */
export interface VercelAiCoreTool<TArgs = any, TResult = any> {
  description: string;
  parameters: any;
  execute: (args: TArgs, context?: ToolExecutionContext) => Promise<TResult>;
  /**
   * Internal identifiers and metadata.
   */
  readonly _toolId: string;
  readonly _toolName: string;
  readonly _toolAlias?: string;
  readonly _isIsolated: boolean;
  readonly _cacheTTL?: number;
  _lastPiiFilteredCount?: number;
}

/**
 * Metadata and descriptor for registered tools in the registry.
 */
export interface RegisteredTool<TArgs = any, TResult = any> {
  id: string;
  name: string;
  alias?: string;
  description: string;
  phases?: string[];
  requiredRoles?: string[];
  tags?: string[];
  tool: VercelAiCoreTool<TArgs, TResult>;
}

/**
 * Strategy interface for dynamically selecting a subset of tools for LLM prompts.
 */
export interface ToolSelectionStrategy {
  selectTools(
    tools: RegisteredTool[],
    context: ToolContext
  ): RegisteredTool[] | Promise<RegisteredTool[]>;
}
