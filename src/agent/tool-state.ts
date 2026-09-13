import type { StepStorageAdapter, ToolSharedState } from "./types";

interface VolatileEntry {
  value: unknown;
  expiresAt?: number;
}

/**
 * Creates a shared blackboard state instance for inter-tool data sharing.
 * Backed by the persistent storage adapter if available, otherwise runs in-memory.
 */
export function createToolSharedState(
  storage?: StepStorageAdapter
): ToolSharedState {
  const volatileMap = new Map<string, VolatileEntry>();

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      if (storage?.getStateValue) {
        return storage.getStateValue<T>(key);
      }
      const entry = volatileMap.get(key);
      if (!entry) {
        return null;
      }
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        volatileMap.delete(key);
        return null;
      }
      return entry.value as T;
    },

    async set<T = unknown>(
      key: string,
      value: T,
      ttlSeconds?: number
    ): Promise<void> {
      if (storage?.setStateValue) {
        await storage.setStateValue<T>(key, value, ttlSeconds);
        return;
      }
      const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined;
      volatileMap.set(key, { value, expiresAt });
    },

    async delete(key: string): Promise<void> {
      if (storage?.deleteStateValue) {
        await storage.deleteStateValue(key);
        return;
      }
      volatileMap.delete(key);
    },

    async clear(): Promise<void> {
      if (storage?.clearStateValues) {
        await storage.clearStateValues();
        return;
      }
      volatileMap.clear();
    },
  };
}
