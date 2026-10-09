export interface DeepFreezeOptions {
  maxDepth?: number;
}

export const deepFreeze = <T>(
  target: T,
  options?: DeepFreezeOptions,
  currentDepth = 0,
  visited = new WeakSet<object>()
): Readonly<T> => {
  if (target === null || typeof target !== "object") {
    return target as Readonly<T>;
  }

  if (visited.has(target)) {
    return target as Readonly<T>;
  }

  const maxDepth = options?.maxDepth ?? 10;
  if (Object.isFrozen(target) || currentDepth >= maxDepth) {
    return target as Readonly<T>;
  }

  if (target instanceof Date || target instanceof RegExp || target instanceof Promise) {
    return Object.freeze(target) as Readonly<T>;
  }

  visited.add(target);

  const values = Array.isArray(target) ? target : Object.values(target);
  for (const value of values) {
    if (value && typeof value === "object") {
      deepFreeze(value, options, currentDepth + 1, visited);
    }
  }

  return Object.freeze(target) as Readonly<T>;
};
