import { createIsolatedTool } from "./isolated-tool";
import type {
  IsolatedToolConfig,
  ToolContext,
  VercelAiCoreTool,
} from "./types";

/**
 * Factory for creating isolated tools with injected context and dependencies.
 */
export class AgentToolFactory {
  private readonly context: ToolContext;

  constructor(defaultContext: ToolContext = {}) {
    this.context = Object.freeze({ ...defaultContext });
  }

  /**
   * Returns a new factory instance with merged context.
   */
  public withContext(extraContext: ToolContext): AgentToolFactory {
    return new AgentToolFactory({
      ...this.context,
      ...extraContext,
    });
  }

  /**
   * Returns current factory context.
   */
  public getContext(): ToolContext {
    return this.context;
  }

  /**
   * Instantiates an isolated tool by injecting factory context into the builder function.
   */
  public createTool<TArgs = any, TResult = any>(
    builder: (context: ToolContext) => IsolatedToolConfig<TArgs, TResult>
  ): VercelAiCoreTool<TArgs, TResult> {
    const config = builder(this.context);
    return createIsolatedTool<TArgs, TResult>(config);
  }
}
