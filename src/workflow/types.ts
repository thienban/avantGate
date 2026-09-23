import type { ZodType } from "zod";
import type {
  IsolatedTool,
  StepApprovalOptions,
  StepStorageAdapter,
  ToolImpact,
} from "../agent/types";

export interface WorkflowStepContext {
  readonly workflowId: string;
  readonly stepId: string;
  readonly runId?: string;
  readonly tenantId?: string;
  readonly userId?: string;
  readonly services: Record<string, any>;
  readonly storage?: StepStorageAdapter;
  getStepResult<T = unknown>(stepId: string): T | undefined;
  waitForApproval<T = unknown>(options?: StepApprovalOptions<T>): Promise<T>;
  abort<TPayload = unknown>(reason: string, payload?: TPayload): never;
}

export interface WorkflowStepConfig<TInput = any, TOutput = any> {
  id: string;
  name: string;
  description?: string;
  impact?: ToolImpact;
  checkpoint?: boolean;
  execute: (input: TInput, ctx: WorkflowStepContext) => Promise<TOutput>;
  compensate?: (stepResult: TOutput, input: TInput, ctx: WorkflowStepContext) => Promise<void>;
}

export interface WorkflowConfig<TInput = any, TOutput = any> {
  id: string;
  name: string;
  description?: string;
  inputSchema: ZodType<TInput>;
  roles?: string[];
  impact?: ToolImpact;
  invalidationTags?:
    | string[]
    | ((input: TInput, results: Record<string, any>) => string[] | Promise<string[]>);
  steps: WorkflowStepConfig<TInput, any>[];
  outputDto?: (results: Record<string, any>, input: TInput) => TOutput;
}

export interface WorkflowExecutionContext {
  tenantId?: string;
  userId?: string;
  runId?: string;
  services?: Record<string, any>;
  storage?: StepStorageAdapter;
}

export interface WorkflowAsToolOptions {
  storage?: StepStorageAdapter;
  impact?: ToolImpact;
  requireApproval?: boolean;
  defaultContext?: Partial<WorkflowExecutionContext>;
}

export interface WorkflowExecutionResult<TOutput = any> {
  workflowId: string;
  runId: string;
  status: "COMPLETED" | "FAILED" | "WAITING_APPROVAL" | "ABORTED";
  stepResults: Record<string, any>;
  output?: TOutput;
  abortReason?: string;
  abortPayload?: unknown;
}

export interface WorkflowInstance<TInput = any, TOutput = any> {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly impact: ToolImpact;
  readonly roles?: string[];
  readonly config: WorkflowConfig<TInput, TOutput>;
  execute(
    input: TInput,
    context?: WorkflowExecutionContext
  ): Promise<WorkflowExecutionResult<TOutput>>;
  asTool(options?: WorkflowAsToolOptions): IsolatedTool<TInput, TOutput>;
}
