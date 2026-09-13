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

  constructor(toolName: string, requiredRole?: string) {
    const roleMsg = requiredRole ? ` (requires role "${requiredRole}")` : "";
    super(`Access denied for tool "${toolName}"${roleMsg}.`);
    this.name = "ToolAccessDeniedError";
    this.toolName = toolName;
    this.requiredRole = requiredRole;
  }
}
