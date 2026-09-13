import type {
  StepRecord,
  StepStatus,
  StepStorageAdapter,
  ToolExecutionRecord,
} from "../types";

export interface MemoryAdapterOptions {
  ttlMs?: number;
}

interface StoredEntry {
  record: StepRecord;
  expiresAt?: number;
}

interface CacheEntry {
  result: unknown;
  expiresAt: number;
}

interface StateEntry {
  value: unknown;
  expiresAt?: number;
}

/**
 * In-memory storage adapter for development, prototyping, and tests.
 * Zero-infrastructure and ultra-fast with complete tool trace and cache support.
 */
export class MemoryStorageAdapter implements StepStorageAdapter {
  private readonly storage = new Map<string, StoredEntry>();
  private readonly toolExecutions: ToolExecutionRecord[] = [];
  private readonly cacheStorage = new Map<string, CacheEntry>();
  private readonly stateStorage = new Map<string, StateEntry>();
  private readonly ttlMs?: number;

  constructor(options: MemoryAdapterOptions = {}) {
    this.ttlMs = options.ttlMs;
  }

  private buildKey(workflowId: string, stepId: string): string {
    return `${workflowId}::${stepId}`;
  }

  private isExpired(entry: StoredEntry): boolean {
    if (!entry.expiresAt) {
      return false;
    }
    return Date.now() > entry.expiresAt;
  }

  public async getStep<T = unknown>(
    workflowId: string,
    stepId: string
  ): Promise<StepRecord<T> | null> {
    const key = this.buildKey(workflowId, stepId);
    const entry = this.storage.get(key);
    if (!entry) {
      return null;
    }
    if (this.isExpired(entry)) {
      this.storage.delete(key);
      return null;
    }
    return entry.record as StepRecord<T>;
  }

  public async saveStep<T = unknown>(step: StepRecord<T>): Promise<void> {
    const key = this.buildKey(step.workflowId, step.stepId);
    const expiresAt = this.ttlMs ? Date.now() + this.ttlMs : undefined;
    this.storage.set(key, {
      record: step as StepRecord,
      expiresAt,
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
    const results: StepRecord[] = [];
    for (const [key, entry] of this.storage.entries()) {
      if (this.isExpired(entry)) {
        this.storage.delete(key);
        continue;
      }
      if (entry.record.workflowId === workflowId) {
        results.push(entry.record);
      }
    }
    return results;
  }

  public async saveToolExecution(record: ToolExecutionRecord): Promise<void> {
    this.toolExecutions.push(record);
  }

  public async listToolExecutions(
    workflowId?: string,
    stepId?: string
  ): Promise<ToolExecutionRecord[]> {
    return this.toolExecutions.filter((item) => {
      if (workflowId && item.workflowId !== workflowId) return false;
      if (stepId && item.stepId !== stepId) return false;
      return true;
    });
  }

  public async getCachedToolResult<T = unknown>(cacheKey: string): Promise<T | null> {
    const entry = this.cacheStorage.get(cacheKey);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.cacheStorage.delete(cacheKey);
      return null;
    }
    return entry.result as T;
  }

  public async setCachedToolResult<T = unknown>(
    cacheKey: string,
    result: T,
    ttlSeconds: number
  ): Promise<void> {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.cacheStorage.set(cacheKey, { result, expiresAt });
  }

  public async getStateValue<T = unknown>(key: string): Promise<T | null> {
    const entry = this.stateStorage.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.stateStorage.delete(key);
      return null;
    }
    return entry.value as T;
  }

  public async setStateValue<T = unknown>(
    key: string,
    value: T,
    ttlSeconds?: number
  ): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
    this.stateStorage.set(key, { value, expiresAt });
  }

  public async deleteStateValue(key: string): Promise<void> {
    this.stateStorage.delete(key);
  }

  /**
   * Resets all internal in-memory maps (useful for test isolation).
   */
  public clear(): void {
    this.storage.clear();
    this.toolExecutions.length = 0;
    this.cacheStorage.clear();
    this.stateStorage.clear();
  }
}
