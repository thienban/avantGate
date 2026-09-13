import type {
  StepRecord,
  StepStatus,
  StepStorageAdapter,
} from "../types";

export interface PrismaStepModelDelegate {
  findUnique(args: {
    where: {
      workflowId_stepId: { workflowId: string; stepId: string };
    };
  }): Promise<any>;
  upsert(args: {
    where: {
      workflowId_stepId: { workflowId: string; stepId: string };
    };
    create: any;
    update: any;
  }): Promise<any>;
  findMany(args: {
    where: { workflowId: string };
    orderBy?: any;
  }): Promise<any[]>;
}

function toStepRecord<T>(raw: any): StepRecord<T> {
  const result = typeof raw.result === "string" ? tryParseJson(raw.result) : raw.result;
  const metadata = typeof raw.metadata === "string" ? tryParseJson(raw.metadata) : raw.metadata;
  return {
    workflowId: raw.workflowId,
    stepId: raw.stepId,
    status: raw.status as StepStatus,
    result,
    error: raw.error ?? undefined,
    metadata,
    createdAt: raw.createdAt instanceof Date ? raw.createdAt.toISOString() : String(raw.createdAt),
    updatedAt: raw.updatedAt instanceof Date ? raw.updatedAt.toISOString() : String(raw.updatedAt),
  };
}

function tryParseJson(value: unknown): any {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Storage adapter integrating with Prisma ORM without imposing a direct dependency.
 */
export class PrismaStorageAdapter implements StepStorageAdapter {
  private readonly model: PrismaStepModelDelegate;

  constructor(model: PrismaStepModelDelegate) {
    this.model = model;
  }

  public async getStep<T = unknown>(
    workflowId: string,
    stepId: string
  ): Promise<StepRecord<T> | null> {
    const raw = await this.model.findUnique({
      where: {
        workflowId_stepId: { workflowId, stepId },
      },
    });
    if (!raw) {
      return null;
    }
    return toStepRecord<T>(raw);
  }

  public async saveStep<T = unknown>(step: StepRecord<T>): Promise<void> {
    const payload = {
      workflowId: step.workflowId,
      stepId: step.stepId,
      status: step.status,
      result: step.result !== undefined ? JSON.stringify(step.result) : null,
      error: step.error ?? null,
      metadata: step.metadata ? JSON.stringify(step.metadata) : null,
      updatedAt: new Date(step.updatedAt),
    };

    await this.model.upsert({
      where: {
        workflowId_stepId: {
          workflowId: step.workflowId,
          stepId: step.stepId,
        },
      },
      create: {
        ...payload,
        createdAt: new Date(step.createdAt),
      },
      update: payload,
    });
  }

  public async updateStepStatus<T = unknown>(
    workflowId: string,
    stepId: string,
    status: StepStatus,
    patch?: Partial<StepRecord<T>>
  ): Promise<void> {
    const existing = await this.getStep<T>(workflowId, stepId);
    const now = new Date().toISOString();
    const updated: StepRecord<T> = {
      ...(existing ?? {
        workflowId,
        stepId,
        createdAt: now,
      }),
      ...patch,
      status,
      updatedAt: now,
    };
    await this.saveStep(updated);
  }

  public async listSteps(workflowId: string): Promise<StepRecord[]> {
    const list = await this.model.findMany({
      where: { workflowId },
      orderBy: { createdAt: "asc" },
    });
    return list.map(toStepRecord);
  }
}
