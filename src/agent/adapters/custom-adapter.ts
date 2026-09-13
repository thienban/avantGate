import type {
  StepRecord,
  StepStatus,
  StepStorageAdapter,
} from "../types";

export interface CustomStorageHandlers {
  getStep: <T = unknown>(
    workflowId: string,
    stepId: string
  ) => Promise<StepRecord<T> | null>;
  saveStep: <T = unknown>(step: StepRecord<T>) => Promise<void>;
  updateStepStatus: <T = unknown>(
    workflowId: string,
    stepId: string,
    status: StepStatus,
    patch?: Partial<StepRecord<T>>
  ) => Promise<void>;
  listSteps: (workflowId: string) => Promise<StepRecord[]>;
}

export interface KeyValueStoreClient {
  get(key: string): Promise<string | null> | string | null;
  set(
    key: string,
    value: string,
    ttlSeconds?: number
  ): Promise<void | unknown> | void | unknown;
  keys?(pattern?: string): Promise<string[]> | string[];
}

export interface KeyValueAdapterOptions {
  prefix?: string;
  ttlSeconds?: number;
}

/**
 * Universal functional builder for plugging any external storage library
 * (Drizzle, Kysely, Supabase, TypeORM, Mongo, custom REST API...)
 */
export function createCustomStorageAdapter(
  handlers: CustomStorageHandlers
): StepStorageAdapter {
  return {
    getStep: handlers.getStep,
    saveStep: handlers.saveStep,
    updateStepStatus: handlers.updateStepStatus,
    listSteps: handlers.listSteps,
  };
}

/**
 * Universal Key-Value adapter enabling any KV client (Redis, Upstash, Cloudflare KV,
 * Keyv, Memcached) to be plugged in with simple get/set operations.
 */
export class KeyValueStorageAdapter implements StepStorageAdapter {
  private readonly client: KeyValueStoreClient;
  private readonly prefix: string;
  private readonly ttlSeconds?: number;

  constructor(client: KeyValueStoreClient, options: KeyValueAdapterOptions = {}) {
    this.client = client;
    this.prefix = options.prefix ?? "avantgate:step:";
    this.ttlSeconds = options.ttlSeconds;
  }

  private buildKey(workflowId: string, stepId: string): string {
    return `${this.prefix}${workflowId}:${stepId}`;
  }

  public async getStep<T = unknown>(
    workflowId: string,
    stepId: string
  ): Promise<StepRecord<T> | null> {
    const raw = await this.client.get(this.buildKey(workflowId, stepId));
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as StepRecord<T>;
    } catch {
      return null;
    }
  }

  public async saveStep<T = unknown>(step: StepRecord<T>): Promise<void> {
    const key = this.buildKey(step.workflowId, step.stepId);
    const serialized = JSON.stringify(step);
    await this.client.set(key, serialized, this.ttlSeconds);
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
    if (!this.client.keys) {
      return [];
    }
    const pattern = `${this.prefix}${workflowId}:*`;
    const matchedKeys = await this.client.keys(pattern);
    const records: StepRecord[] = [];

    for (const key of matchedKeys) {
      const raw = await this.client.get(key);
      if (raw) {
        try {
          records.push(JSON.parse(raw) as StepRecord);
        } catch {
          // ignore corrupted keys
        }
      }
    }
    return records;
  }
}
