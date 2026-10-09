/**
 * Domain and operational errors for avantgate/agent.
 */

export class StepSuspendedError extends Error {
  public readonly stepId: string;
  public readonly workflowId: string;
  public readonly metadata?: Record<string, unknown>;

  constructor(stepId: string, workflowId: string, metadata?: Record<string, unknown>) {
    super(`Step execution suspended for human approval: [${workflowId}::${stepId}]`);
    this.name = "StepSuspendedError";
    this.stepId = stepId;
    this.workflowId = workflowId;
    this.metadata = metadata;
  }
}

export class PiiLeakError extends Error {
  public readonly toolName: string;
  public readonly maskedCount: number;

  constructor(toolName: string, maskedCount: number) {
    super(`PII leak detected in tool output for "${toolName}" (${maskedCount} occurrences detected).`);
    this.name = "PiiLeakError";
    this.toolName = toolName;
    this.maskedCount = maskedCount;
  }
}

export class StepExecutionError extends Error {
  public readonly stepId: string;
  public readonly workflowId: string;
  public readonly originalError?: unknown;

  constructor(stepId: string, workflowId: string, message: string, originalError?: unknown) {
    super(`Execution failed at step [${workflowId}::${stepId}]: ${message}`);
    this.name = "StepExecutionError";
    this.stepId = stepId;
    this.workflowId = workflowId;
    this.originalError = originalError;
  }
}

export class ToolAccessDeniedError extends Error {
  public readonly toolName: string;
  public readonly requiredRole?: string;
  public readonly reason?: string;

  constructor(toolName: string, reasonOrRole?: string) {
    const isRole = Boolean(reasonOrRole && !reasonOrRole.includes(" "));
    const roleMsg = isRole ? ` (requires role "${reasonOrRole}")` : "";
    const reasonMsg = reasonOrRole && !isRole ? `: ${reasonOrRole}` : "";
    super(`Access denied for tool "${toolName}"${roleMsg}${reasonMsg}.`);
    this.name = "ToolAccessDeniedError";
    this.toolName = toolName;
    if (isRole) {
      this.requiredRole = reasonOrRole;
    } else {
      this.reason = reasonOrRole;
    }
  }
}

export class CircularToolCallError extends Error {
  public readonly cycle: string[];

  constructor(cycle: string[]) {
    super(`Circular tool call detected: ${cycle.join(" -> ")}`);
    this.name = "CircularToolCallError";
    this.cycle = cycle;
  }
}

export class ToolCallDepthExceededError extends Error {
  public readonly depth: number;
  public readonly maxDepth: number;

  constructor(depth: number, maxDepth: number) {
    super(`Tool call depth limit exceeded: depth ${depth} exceeds max allowed depth of ${maxDepth}.`);
    this.name = "ToolCallDepthExceededError";
    this.depth = depth;
    this.maxDepth = maxDepth;
  }
}

export class ToolSubCallQuotaError extends Error {
  public readonly totalCalls: number;
  public readonly maxCalls: number;

  constructor(totalCalls: number, maxCalls: number) {
    super(`Tool sub-call quota exceeded: ${totalCalls} calls exceeds session quota of ${maxCalls}.`);
    this.name = "ToolSubCallQuotaError";
    this.totalCalls = totalCalls;
    this.maxCalls = maxCalls;
  }
}

export class ToolNotFoundError extends Error {
  public readonly toolId: string;

  constructor(toolId: string) {
    super(`Tool not found in registry: "${toolId}".`);
    this.name = "ToolNotFoundError";
    this.toolId = toolId;
  }
}

export class DtoValidationError extends Error {
  public readonly toolName: string;
  public readonly issues: unknown[];

  constructor(toolName: string, message: string, issues: unknown[] = []) {
    super(`LLM DTO validation failed for tool "${toolName}": ${message}`);
    this.name = "DtoValidationError";
    this.toolName = toolName;
    this.issues = issues;
  }
}

export interface AmbiguousToolExecutionDetails {
  toolCallId: string;
  toolName?: string;
  impact?: string;
  message?: string;
  originalError?: unknown;
}

export class AmbiguousToolExecutionError extends Error {
  public readonly toolCallId: string;
  public readonly toolName?: string;
  public readonly impact?: string;
  public readonly originalError?: unknown;

  constructor(details: AmbiguousToolExecutionDetails | string, toolName?: string, impact?: string) {
    const isStr = typeof details === "string";
    const callId = isStr ? details : details.toolCallId;
    const name = isStr ? toolName : details.toolName;
    const imp = isStr ? (impact ?? "MUTATIVE") : (details.impact ?? "MUTATIVE");
    const msg = isStr ? "" : (details.message ? `: ${details.message}` : "");
    super(`Ambiguous tool execution detected for [${name || "tool"}::${callId}] (${imp})${msg}. Re-execution blocked without reconciliation.`);
    this.name = "AmbiguousToolExecutionError";
    this.toolCallId = callId;
    this.toolName = name;
    this.impact = imp;
    this.originalError = isStr ? undefined : details.originalError;
  }
}

