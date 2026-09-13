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
      return tools.filter((t) => !t.requiredRoles || t.requiredRoles.length === 0);
    }
    const currentRole = context.role;
    return tools.filter((item) => {
      if (!item.requiredRoles || item.requiredRoles.length === 0) {
        return true;
      }
      return item.requiredRoles.includes(currentRole);
    });
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
