import type { RegisteredTool, VercelAiCoreTool } from "./types";

/**
 * Centralized catalog for managing and filtering tools with permissions and metadata.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  /**
   * Registers a new tool in the registry.
   */
  public register(toolDef: RegisteredTool): this {
    this.tools.set(toolDef.name, toolDef);
    return this;
  }

  /**
   * Retrieves a tool by its unique name.
   */
  public get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Checks if a tool is registered.
   */
  public has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Returns all registered tools.
   */
  public getAll(): RegisteredTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Filters tools matching a specific workflow phase.
   */
  public getByPhase(phase: string): RegisteredTool[] {
    return this.getAll().filter((item) => {
      if (!item.phases || item.phases.length === 0) {
        return true;
      }
      return item.phases.includes(phase);
    });
  }

  /**
   * Filters tools matching the user's roles (RBAC).
   */
  public filterByRoles(userRoles: string[]): RegisteredTool[] {
    const roleSet = new Set(userRoles);
    return this.getAll().filter((item) => {
      if (!item.requiredRoles || item.requiredRoles.length === 0) {
        return true;
      }
      return item.requiredRoles.some((role) => roleSet.has(role));
    });
  }

  /**
   * Converts a list of registered tools to the record map format required by Vercel AI SDK.
   */
  public static toRecord(
    tools: RegisteredTool[]
  ): Record<string, VercelAiCoreTool> {
    const record: Record<string, VercelAiCoreTool> = {};
    for (const item of tools) {
      record[item.name] = item.tool;
    }
    return record;
  }
}
