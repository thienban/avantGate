import { ToolRegistry } from "./registry";
import type {
  RegisteredTool,
  ToolContext,
  ToolSelectionStrategy,
  VercelAiCoreTool,
} from "./types";

/**
 * Strategy selecting tools that match the current workflow phase.
 */
export class PhaseBasedToolStrategy implements ToolSelectionStrategy {
  public selectTools(
    tools: RegisteredTool[],
    context: ToolContext
  ): RegisteredTool[] {
    if (!context.phase) {
      return tools;
    }
    const currentPhase = context.phase;
    return tools.filter((item) => {
      if (!item.phases || item.phases.length === 0) {
        return true;
      }
      return item.phases.includes(currentPhase);
    });
  }
}

/**
 * Strategy selecting tools permitted for the user's role (RBAC).
 */
export class RoleBasedToolStrategy implements ToolSelectionStrategy {
  public selectTools(
    tools: RegisteredTool[],
    context: ToolContext
  ): RegisteredTool[] {
    if (!context.role) {
      return tools.filter((toolCandidate) => {
        const roles = toolCandidate.roles ?? toolCandidate.requiredRoles;
        return !roles || roles.length === 0;
      });
    }
    const currentRole = context.role;
    return tools.filter((item) => {
      const roles = item.roles ?? item.requiredRoles;
      if (!roles || roles.length === 0) {
        return true;
      }
      return roles.includes(currentRole);
    });
  }
}

export interface AccessControlToolStrategyOptions {
  allowedDomains?: string[];
}

function matchesDomain(tool: RegisteredTool, allowedDomains?: Set<string>): boolean {
  if (!allowedDomains) {
    return true;
  }
  return Boolean(tool.domain && allowedDomains.has(tool.domain));
}

function matchesRoles(tool: RegisteredTool, context: ToolContext): boolean {
  const toolRoles = tool.roles ?? tool.requiredRoles;
  if (!toolRoles || toolRoles.length === 0) {
    return true;
  }
  const userRoles: string[] = [];
  if (context.role) {
    userRoles.push(context.role);
  }
  if (context.roles) {
    userRoles.push(...context.roles);
  }
  if (userRoles.length === 0) {
    return false;
  }
  return toolRoles.some((roleName) => userRoles.includes(roleName));
}

function matchesPermissions(tool: RegisteredTool, context: ToolContext): boolean {
  if (!tool.permissions || tool.permissions.length === 0) {
    return true;
  }
  const userPermissions = context.permissions ?? [];
  return tool.permissions.every((permissionName) => userPermissions.includes(permissionName));
}

/**
 * Unified strategy evaluating role, permissions and allowed business domains in a single pass.
 */
export class AccessControlToolStrategy implements ToolSelectionStrategy {
  private readonly allowedDomains?: Set<string>;

  constructor(options?: AccessControlToolStrategyOptions) {
    if (options?.allowedDomains) {
      this.allowedDomains = new Set(options.allowedDomains);
    }
  }

  public selectTools(
    tools: RegisteredTool[],
    context: ToolContext
  ): RegisteredTool[] {
    return tools.filter(
      (tool) =>
        matchesDomain(tool, this.allowedDomains) &&
        matchesRoles(tool, context) &&
        matchesPermissions(tool, context)
    );
  }
}

/**
 * Composite strategy applying multiple selection strategies sequentially (intersection).
 */
export class CompositeToolStrategy implements ToolSelectionStrategy {
  private readonly strategies: ToolSelectionStrategy[];

  constructor(strategies: ToolSelectionStrategy[]) {
    this.strategies = strategies;
  }

  public async selectTools(
    tools: RegisteredTool[],
    context: ToolContext
  ): Promise<RegisteredTool[]> {
    let current = tools;
    for (const strategy of this.strategies) {
      current = await strategy.selectTools(current, context);
    }
    return current;
  }
}

/**
 * Convenience helper to execute a strategy and convert selected tools to Vercel AI SDK format.
 */
export async function applyToolStrategy(
  tools: RegisteredTool[],
  strategy: ToolSelectionStrategy,
  context: ToolContext
): Promise<Record<string, VercelAiCoreTool>> {
  const selected = await strategy.selectTools(tools, context);
  return ToolRegistry.toRecord(selected);
}
