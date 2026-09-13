import type { RegisteredTool, VercelAiCoreTool } from "./types";

export interface ToRecordOptions {
  anonymize?: boolean;
}

/**
 * Centralized catalog for managing and filtering tools with permissions and metadata.
 * Supports O(1) Key-Value lookup by technical ID and by public alias.
 */
export class ToolRegistry {
  private readonly toolsById = new Map<string, RegisteredTool>();
  private readonly toolsByPublicName = new Map<string, RegisteredTool>();

  /**
   * Registers a new tool in the registry.
   */
  public register(toolDef: RegisteredTool): this {
    const id = toolDef.id || toolDef.name;
    const publicName = toolDef.alias || toolDef.name;

    const normalizedDef: RegisteredTool = {
      ...toolDef,
      id,
    };

    this.toolsById.set(id, normalizedDef);
    this.toolsByPublicName.set(publicName, normalizedDef);
    return this;
  }

  /**
   * Retrieves a tool by its ID or public name/alias.
   */
  public get(idOrName: string): RegisteredTool | undefined {
    return this.toolsById.get(idOrName) ?? this.toolsByPublicName.get(idOrName);
  }

  /**
   * Retrieves a tool strictly by its immutable technical ID (O(1)).
   */
  public getById(id: string): RegisteredTool | undefined {
    return this.toolsById.get(id);
  }

  /**
   * Retrieves a tool by its public alias seen by the LLM (O(1)).
   */
  public getByPublicName(publicName: string): RegisteredTool | undefined {
    return this.toolsByPublicName.get(publicName);
  }

  /**
   * Checks if a tool is registered by ID or public name.
   */
  public has(idOrName: string): boolean {
    return this.toolsById.has(idOrName) || this.toolsByPublicName.has(idOrName);
  }

  /**
   * Returns all registered tools without duplicates.
   */
  public getAll(): RegisteredTool[] {
    return Array.from(this.toolsById.values());
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
   * Converts instance registered tools to the record map format required by Vercel AI SDK.
   */
  public toRecord(options: ToRecordOptions = {}): Record<string, VercelAiCoreTool> {
    return ToolRegistry.toRecord(this.getAll(), options);
  }

  /**
   * Converts a list of registered tools to the record map format required by Vercel AI SDK.
   * If anonymize is true, uses alias (if defined) as dictionary key instead of technical name.
   */
  public static toRecord(
    tools: RegisteredTool[],
    options: ToRecordOptions = {}
  ): Record<string, VercelAiCoreTool> {
    const record: Record<string, VercelAiCoreTool> = {};
    for (const item of tools) {
      const key = options.anonymize && item.alias ? item.alias : item.name;
      record[key] = item.tool;
    }
    return record;
  }
}
