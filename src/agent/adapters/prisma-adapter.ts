import type {
  StepRecord,
  StepStatus,
  StepStorageAdapter,
  ToolExecutionRecord,
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

export interface PrismaToolDelegates {
  toolExecution?: any;
  toolCache?: any;
  sharedState?: any;
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
  private readonly toolDelegates?: PrismaToolDelegates;
  private readonly volatileCache = new Map<string, { result: unknown; expiresAt: number }>();
  private readonly volatileState = new Map<string, { value: unknown; expiresAt?: number }>();
  private readonly volatileExecutions: ToolExecutionRecord[] = [];

  constructor(model: PrismaStepModelDelegate, toolDelegates?: PrismaToolDelegates) {
    this.model = model;
    this.toolDelegates = toolDelegates;
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

  public async saveToolExecution(record: ToolExecutionRecord): Promise<void> {
    if (this.toolDelegates?.toolExecution) {
      await this.toolDelegates.toolExecution.create({
        data: {
          executionId: record.executionId,
          workflowId: record.workflowId,
          stepId: record.stepId,
          toolId: record.toolId,
          parentToolId: record.parentToolId,
          aliasUsed: record.aliasUsed,
          depth: record.depth,
          inputArgs: record.inputArgs ? JSON.stringify(record.inputArgs) : null,
          outputSummary: record.outputSummary ? JSON.stringify(record.outputSummary) : null,
          durationMs: record.durationMs,
          status: record.status,
          error: record.error,
          createdAt: new Date(record.createdAt),
        },
      });
      return;
    }
    this.volatileExecutions.push(record);
  }

  public async listToolExecutions(
    workflowId?: string,
    stepId?: string
  ): Promise<ToolExecutionRecord[]> {
    if (this.toolDelegates?.toolExecution) {
      const rows = await this.toolDelegates.toolExecution.findMany({
        where: {
          ...(workflowId ? { workflowId } : {}),
          ...(stepId ? { stepId } : {}),
        },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((r: any) => ({
        ...r,
        inputArgs: tryParseJson(r.inputArgs),
        outputSummary: tryParseJson(r.outputSummary),
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      }));
    }
    return this.volatileExecutions.filter((item) => {
      if (workflowId && item.workflowId !== workflowId) return false;
      if (stepId && item.stepId !== stepId) return false;
      return true;
    });
  }

  public async getCachedToolResult<T = unknown>(cacheKey: string): Promise<T | null> {
    if (this.toolDelegates?.toolCache) {
      const row = await this.toolDelegates.toolCache.findUnique({
        where: { cacheKey },
      });
      if (!row || Date.now() > Number(row.expiresAt)) return null;
      return tryParseJson(row.result);
    }
    const entry = this.volatileCache.get(cacheKey);
    if (!entry || Date.now() > entry.expiresAt) return null;
    return entry.result as T;
  }

  public async setCachedToolResult<T = unknown>(
    cacheKey: string,
    result: T,
    ttlSeconds: number
  ): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    if (this.toolDelegates?.toolCache) {
      await this.toolDelegates.toolCache.upsert({
        where: { cacheKey },
        create: { cacheKey, result: JSON.stringify(result), expiresAt },
        update: { result: JSON.stringify(result), expiresAt },
      });
      return;
    }
    this.volatileCache.set(cacheKey, { result, expiresAt });
  }

  public async getStateValue<T = unknown>(key: string): Promise<T | null> {
    if (this.toolDelegates?.sharedState) {
      const row = await this.toolDelegates.sharedState.findUnique({
        where: { stateKey: key },
      });
      if (!row || (row.expiresAt && Date.now() > Number(row.expiresAt))) return null;
      return tryParseJson(row.value);
    }
    const entry = this.volatileState.get(key);
    if (!entry || (entry.expiresAt && Date.now() > entry.expiresAt)) return null;
    return entry.value as T;
  }

  public async setStateValue<T = unknown>(
    key: string,
    value: T,
    ttlSeconds?: number
  ): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    if (this.toolDelegates?.sharedState) {
      await this.toolDelegates.sharedState.upsert({
        where: { stateKey: key },
        create: { stateKey: key, value: JSON.stringify(value), expiresAt },
        update: { value: JSON.stringify(value), expiresAt },
      });
      return;
    }
    this.volatileState.set(key, { value, expiresAt: expiresAt ?? undefined });
  }

  public async deleteStateValue(key: string): Promise<void> {
    if (this.toolDelegates?.sharedState) {
      await this.toolDelegates.sharedState.delete({
        where: { stateKey: key },
      });
      return;
    }
    this.volatileState.delete(key);
  }
}
