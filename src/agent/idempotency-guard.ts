import type { StepStorageAdapter } from "./types";

export interface IdempotencyStore {
  get(key: string): Promise<unknown | undefined> | unknown | undefined;
  set(key: string, value: unknown, ttlSeconds?: number): Promise<void> | void;
}

export interface ServerIdempotencyResult<TResult> {
  result: TResult;
  isCached: boolean;
}

export const withServerIdempotency = async <TResult>(
  idempotencyKey: string | null | undefined,
  store: IdempotencyStore,
  handler: () => Promise<TResult>,
  ttlSeconds = 86400
): Promise<ServerIdempotencyResult<TResult>> => {
  if (!idempotencyKey) {
    const result = await handler();
    return { result, isCached: false };
  }

  const cached = await store.get(idempotencyKey);
  if (cached !== undefined) {
    return { result: cached as TResult, isCached: true };
  }

  const result = await handler();
  await store.set(idempotencyKey, result, ttlSeconds);
  return { result, isCached: false };
};

export const createMemoryIdempotencyStore = (): IdempotencyStore => {
  const cache = new Map<string, { value: unknown; expiresAt?: number }>();

  return {
    get: (key: string): unknown | undefined => {
      const entry = cache.get(key);
      if (!entry) {
        return undefined;
      }
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        cache.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set: (key: string, value: unknown, ttlSeconds?: number): void => {
      const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
      cache.set(key, { value, expiresAt });
    },
  };
};

export const createAdapterIdempotencyStore = (
  adapter: StepStorageAdapter,
  namespace = "idempotency"
): IdempotencyStore => {
  return {
    get: async (key: string): Promise<unknown | undefined> => {
      const scopedKey = `${namespace}:${key}`;
      if (adapter.getStateValue) {
        const val = await adapter.getStateValue(scopedKey);
        return val === null ? undefined : val;
      }
      if (adapter.getCachedToolResult) {
        const val = await adapter.getCachedToolResult(scopedKey);
        return val === null ? undefined : val;
      }
      return undefined;
    },
    set: async (key: string, value: unknown, ttlSeconds?: number): Promise<void> => {
      const scopedKey = `${namespace}:${key}`;
      if (adapter.setStateValue) {
        await adapter.setStateValue(scopedKey, value, ttlSeconds);
        return;
      }
      if (adapter.setCachedToolResult) {
        await adapter.setCachedToolResult(scopedKey, value, ttlSeconds ?? 86400);
      }
    },
  };
};
