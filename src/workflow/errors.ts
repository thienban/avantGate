export interface FailedCompensationRecord {
  stepId: string;
  error: unknown;
}

export class WorkflowSagaRollbackError extends Error {
  readonly workflowId: string;
  readonly failedStepId: string;
  readonly originalError: unknown;
  readonly compensatedSteps: string[];
  readonly failedCompensations: FailedCompensationRecord[];

  constructor(params: {
    workflowId: string;
    failedStepId: string;
    originalError: unknown;
    compensatedSteps: string[];
    failedCompensations?: FailedCompensationRecord[];
  }) {
    const errorDetails =
      params.originalError instanceof Error
        ? params.originalError.message
        : String(params.originalError);

    super(
      `Échec de l'étape '${params.failedStepId}' dans le workflow '${params.workflowId}'. Rollback Saga exécuté sur [${params.compensatedSteps.join(", ")}]. Cause initiale: ${errorDetails}`
    );

    this.name = "WorkflowSagaRollbackError";
    this.workflowId = params.workflowId;
    this.failedStepId = params.failedStepId;
    this.originalError = params.originalError;
    this.compensatedSteps = params.compensatedSteps;
    this.failedCompensations = params.failedCompensations ?? [];
  }
}

export class WorkflowValidationError extends Error {
  readonly workflowId: string;
  readonly issues: unknown[];

  constructor(workflowId: string, issues: unknown[]) {
    super(`Validation des entrées échouée pour le workflow '${workflowId}'.`);
    this.name = "WorkflowValidationError";
    this.workflowId = workflowId;
    this.issues = issues;
  }
}

