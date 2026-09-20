import { ToolRegistry } from "./registry";
import type {
  RegisteredTool,
  ToolContext,
  ToolImpact,
  ToolSelectionStrategy,
  VercelAiCoreTool,
} from "./types";

const IMPACT_WEIGHTS: Record<ToolImpact, number> = {
  READ_ONLY: 1,
  MUTATIVE: 2,
  DESTRUCTIVE: 3,
};

function matchesMaxImpact(tool: RegisteredTool, maxImpact?: ToolImpact): boolean {
  if (!maxImpact) {
    return true;
  }
  const toolImpact = tool.impact ?? "READ_ONLY";
  return IMPACT_WEIGHTS[toolImpact] <= IMPACT_WEIGHTS[maxImpact];
}

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

/**
 * Strategy selecting exclusively observation/read-only tools (ideal for auditors, critics, reflection).
 */
export class ReadOnlyToolStrategy implements ToolSelectionStrategy {
  public selectTools(
    tools: RegisteredTool[],
    _context: ToolContext
  ): RegisteredTool[] {
    return tools.filter((tool) => (tool.impact ?? "READ_ONLY") === "READ_ONLY");
  }
}

/**
 * Strategy capping maximum permitted impact level for autonomous agents.
 */
export class MaxImpactToolStrategy implements ToolSelectionStrategy {
  private readonly maxImpact: ToolImpact;

  constructor(maxImpact: ToolImpact) {
    this.maxImpact = maxImpact;
  }

  public selectTools(
    tools: RegisteredTool[],
    _context: ToolContext
  ): RegisteredTool[] {
    const maxWeight = IMPACT_WEIGHTS[this.maxImpact];
    return tools.filter((tool) => {
      const toolImpact = tool.impact ?? "READ_ONLY";
      return IMPACT_WEIGHTS[toolImpact] <= maxWeight;
    });
  }
}

export interface AccessControlToolStrategyOptions {
  allowedDomains?: string[];
  maxImpact?: ToolImpact;
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

/**
 * Unified strategy evaluating user roles, allowed business domains and maximum impact in a single pass.
 */
export class AccessControlToolStrategy implements ToolSelectionStrategy {
  private readonly allowedDomains?: Set<string>;
  private readonly maxImpact?: ToolImpact;

  constructor(options?: AccessControlToolStrategyOptions) {
    if (options?.allowedDomains) {
      this.allowedDomains = new Set(options.allowedDomains);
    }
    this.maxImpact = options?.maxImpact;
  }

  public selectTools(
    tools: RegisteredTool[],
    context: ToolContext
  ): RegisteredTool[] {
    return tools.filter(
      (tool) =>
        matchesDomain(tool, this.allowedDomains) &&
        matchesRoles(tool, context) &&
        matchesMaxImpact(tool, this.maxImpact)
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
