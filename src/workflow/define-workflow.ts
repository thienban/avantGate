import { createIsolatedTool } from "../agent/isolated-tool";
import type { IsolatedTool, ToolExecutionContext, ToolImpact } from "../agent/types";
import { executeWorkflow } from "./engine";
import type {
  WorkflowAsToolOptions,
  WorkflowConfig,
  WorkflowExecutionContext,
  WorkflowExecutionResult,
  WorkflowInstance,
} from "./types";

const resolveWorkflowImpact = (config: WorkflowConfig, options?: WorkflowAsToolOptions): ToolImpact => {
  if (options?.impact) {
    return options.impact;
  }
  return config.impact ?? "MUTATIVE";
};

const resolveRequireApproval = (
  impact: ToolImpact,
  options?: WorkflowAsToolOptions
): boolean => {
  if (options?.requireApproval !== undefined) {
    return options.requireApproval;
  }
  // Safe Default DESIGN-015: activation automatique si DESTRUCTIVE
  return impact === "DESTRUCTIVE";
};

const buildToolExecutionContext = (
  options?: WorkflowAsToolOptions,
  toolCtx?: ToolExecutionContext
): WorkflowExecutionContext => {
  const tenantId = typeof toolCtx?.tenantId === "string" ? toolCtx.tenantId : options?.defaultContext?.tenantId;
  const userId = typeof toolCtx?.userId === "string" ? toolCtx.userId : options?.defaultContext?.userId;

  return {
    tenantId,
    userId,
    services: options?.defaultContext?.services ?? {},
    storage: options?.storage ?? options?.defaultContext?.storage,
  };
};

export const defineWorkflow = <TInput = any, TOutput = any>(
  config: WorkflowConfig<TInput, TOutput>
): WorkflowInstance<TInput, TOutput> => {
  const workflowImpact: ToolImpact = config.impact ?? "MUTATIVE";

  return {
    id: config.id,
    name: config.name,
    description: config.description,
    impact: workflowImpact,
    roles: config.roles,
    config,

    execute: async (
      input: TInput,
      context?: WorkflowExecutionContext
    ): Promise<WorkflowExecutionResult<TOutput>> => {
      return await executeWorkflow(config, input, context);
    },

    asTool: (options?: WorkflowAsToolOptions): IsolatedTool<TInput, TOutput> => {
      const impact = resolveWorkflowImpact(config, options);
      const requireApproval = resolveRequireApproval(impact, options);

      const tool = createIsolatedTool<TInput, TOutput, TOutput, TOutput>({
        name: config.id,
        description: config.description ?? config.name,
        roles: config.roles,
        impact,
        requireApproval,
        parameters: config.inputSchema,
        invalidationTags:
          typeof config.invalidationTags === "function"
            ? async (args: TInput, res?: TOutput) => {
                const resolver = config.invalidationTags as (
                  args: TInput,
                  res?: any
                ) => string[] | Promise<string[]>;
                return await resolver(args, res ?? ({} as any));
              }
            : config.invalidationTags,

        execute: async (args: TInput, toolCtx?: ToolExecutionContext): Promise<TOutput> => {
          const executionContext = buildToolExecutionContext(options, toolCtx);
          const result = await executeWorkflow(config, args, executionContext);
          return result.output as TOutput;
        },

        llmDto: (result: TOutput) => result,
      });

      // Enrichissement de métadonnées intrinsèques pour ToolRegistry / Supervision
      Object.assign(tool, {
        _isWorkflow: true,
        workflowId: config.id,
        workflowConfig: {
          totalSteps: config.steps.length,
          impact,
        },
      });

      return tool;
    },
  };
}
