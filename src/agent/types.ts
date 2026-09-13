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
 * Record representing a durable step stored in persistence.
 */
export interface StepRecord<TResult = unknown> {
  workflowId: string;
  stepId: string;
  status: StepStatus;
  result?: TResult;
  error?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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
  storage?: StepStorageAdapter;
}

/**
 * Context received by tool execution.
 */
export interface ToolExecutionContext {
  toolCallId?: string;
  messages?: unknown[];
  abortSignal?: AbortSignal;
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
 * Configuration for creating an isolated tool with PII protection and Dual-Channel.
 */
export interface IsolatedToolConfig<TArgs = any, TResult = any> {
  name: string;
  description: string;
  parameters: z.ZodType<TArgs> | unknown;
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
   * Internal reference to isolated tool configuration.
   */
  readonly _toolName: string;
  readonly _isIsolated: boolean;
}

/**
 * Metadata and descriptor for registered tools in the registry.
 */
export interface RegisteredTool<TArgs = any, TResult = any> {
  name: string;
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
