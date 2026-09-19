import type { RegisteredTool, ToolDescriptor, VercelAiCoreTool } from "./types";

export interface ToRecordOptions {
  anonymize?: boolean;
  domain?: string;
}

export interface ToolDescriptorFilter {
  domain?: string;
  role?: string;
}

function isCoreTool(item: RegisteredTool | VercelAiCoreTool): item is VercelAiCoreTool {
  return typeof (item as VercelAiCoreTool).execute === "function" && "_toolId" in item;
}

function normalizeToolDefinition(toolDef: RegisteredTool | VercelAiCoreTool): RegisteredTool {
  if (isCoreTool(toolDef)) {
    return {
      id: toolDef._toolId || toolDef._toolName,
      name: toolDef._toolName,
      alias: toolDef._toolAlias,
      description: toolDef.description,
      domain: toolDef._domain,
      resource: toolDef._resource,
      roles: toolDef._roles ? Array.from(toolDef._roles) : undefined,
      permissions: toolDef._permissions ? Array.from(toolDef._permissions) : undefined,
      requireApproval: toolDef._requireApproval,
      tool: toolDef,
    };
  }

  const id = toolDef.id || toolDef.name || toolDef.tool?._toolId;
  const publicName = toolDef.alias || toolDef.name || toolDef.tool?._toolAlias || toolDef.tool?._toolName;
  const roles = toolDef.roles ?? (toolDef.tool?._roles ? Array.from(toolDef.tool._roles) : toolDef.requiredRoles);
  const permissions =
    toolDef.permissions ?? (toolDef.tool?._permissions ? Array.from(toolDef.tool._permissions) : undefined);

  return {
    ...toolDef,
    id,
    name: toolDef.name || toolDef.tool?._toolName || id,
    alias: publicName,
    domain: toolDef.domain ?? toolDef.tool?._domain,
    resource: toolDef.resource ?? toolDef.tool?._resource,
    roles,
    permissions,
    requireApproval: toolDef.requireApproval ?? toolDef.tool?._requireApproval,
  };
}

function matchesRoleFilter(tool: RegisteredTool, role?: string): boolean {
  if (!role) {
    return true;
  }
  const roles = tool.roles ?? tool.requiredRoles;
  if (!roles || roles.length === 0) {
    return true;
  }
  return roles.includes(role);
}

function toDescriptor(tool: RegisteredTool): ToolDescriptor {
  return {
    id: tool.id,
    name: tool.name,
    alias: tool.alias,
    description: tool.description,
    domain: tool.domain,
    resource: tool.resource,
    roles: tool.roles ?? tool.requiredRoles,
    permissions: tool.permissions,
    requireApproval: tool.requireApproval,
    cacheTTL: tool.tool._cacheTTL,
    tags: tool.tags,
  };
}

/**
 * Centralized catalog for managing and filtering tools with permissions, domains and metadata.
 * Supports O(1) Key-Value lookup by technical ID and by public alias.
 */
export class ToolRegistry {
  private readonly toolsById = new Map<string, RegisteredTool>();
  private readonly toolsByPublicName = new Map<string, RegisteredTool>();

  /**
   * Registers a new tool in the registry.
   */
  public register(toolDef: RegisteredTool | VercelAiCoreTool): this {
    const normalizedDef = normalizeToolDefinition(toolDef);
    const publicName = normalizedDef.alias || normalizedDef.name;

    this.toolsById.set(normalizedDef.id, normalizedDef);
    this.toolsByPublicName.set(publicName, normalizedDef);
    return this;
  }

  /**
   * Registers multiple tools in batch.
   */
  public registerMany(tools: (RegisteredTool | VercelAiCoreTool)[]): this {
    for (const tool of tools) {
      this.register(tool);
    }
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
   * Filters tools belonging to a specific business domain.
   */
  public getByDomain(domain: string): RegisteredTool[] {
    return this.getAll().filter((item) => item.domain === domain);
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
      const roles = item.roles ?? item.requiredRoles;
      if (!roles || roles.length === 0) {
        return true;
      }
      return roles.some((role) => roleSet.has(role));
    });
  }

  /**
   * Exports headless technical descriptors without UI rendering coupling.
   */
  public getDescriptors(filter?: ToolDescriptorFilter): ToolDescriptor[] {
    let list = this.getAll();
    if (filter?.domain) {
      list = list.filter((item) => item.domain === filter.domain);
    }
    if (filter?.role) {
      list = list.filter((item) => matchesRoleFilter(item, filter.role));
    }
    return list.map(toDescriptor);
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
    let filtered = tools;
    if (options.domain) {
      filtered = filtered.filter((item) => item.domain === options.domain);
    }
    const record: Record<string, VercelAiCoreTool> = {};
    for (const item of filtered) {
      const key = options.anonymize && item.alias ? item.alias : item.name;
      record[key] = item.tool;
    }
    return record;
  }
}
