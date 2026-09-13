import type {
  StepRecord,
  StepStatus,
  StepStorageAdapter,
} from "../types";

export interface MemoryAdapterOptions {
  ttlMs?: number;
}

interface StoredEntry {
  record: StepRecord;
  expiresAt?: number;
}

/**
 * In-memory storage adapter for development, prototyping, and tests.
 * Zero-infrastructure and ultra-fast.
 */
export class MemoryStorageAdapter implements StepStorageAdapter {
  private readonly storage = new Map<string, StoredEntry>();
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

  /**
   * Resets internal in-memory map (useful for test isolation).
   */
  public clear(): void {
    this.storage.clear();
  }
}
