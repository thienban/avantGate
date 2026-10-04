import type { ToolExecutionEnvelope, UIIntent } from "./envelope";

export type CanvasContentState<TContentMap extends Record<string, unknown>> = {
  [K in keyof TContentMap]: { kind: K } & TContentMap[K];
}[keyof TContentMap] | null;

export interface CanvasState<TContentMap extends Record<string, unknown>> {
  content: CanvasContentState<TContentMap>;
  activeIntent?: UIIntent;
}

export const isSafeKey = (key: string): boolean => {
  return key !== "__proto__" && key !== "constructor" && key !== "prototype";
};

const filterSafeKeys = (source: Record<string, any>): Record<string, any> => {
  const result: Record<string, any> = {};
  for (const key of Object.keys(source)) {
    if (isSafeKey(key)) {
      result[key] = source[key];
    }
  }
  return result;
};

const mergeEntityArrays = (
  prevItems: any[],
  incomingItems: any[],
  dedupeKey: string
): any[] => {
  const seenKeys = new Set(
    prevItems
      .filter((item) => item && typeof item === "object" && dedupeKey in item)
      .map((item) => String(item[dedupeKey]))
  );

  const uniqueIncoming = incomingItems.filter((item) => {
    const keyVal = item && typeof item === "object" ? String(item[dedupeKey]) : null;
    if (!keyVal || seenKeys.has(keyVal)) {
      return false;
    }
    seenKeys.add(keyVal);
    return true;
  });

  return [...prevItems, ...uniqueIncoming];
};

export const mergeUniqueEntities = (
  prevContent: Record<string, any>,
  data: any,
  dedupeKey: string
): Record<string, any> => {
  if (Array.isArray(data) && Array.isArray(prevContent)) {
    return mergeEntityArrays(prevContent, data, dedupeKey);
  }
  if (!data || typeof data !== "object") {
    return { ...prevContent };
  }

  const result: Record<string, any> = filterSafeKeys(prevContent);
  const safeData = filterSafeKeys(data);

  for (const key of Object.keys(safeData)) {
    const incoming = safeData[key];
    const prev = result[key];
    result[key] = Array.isArray(incoming) && Array.isArray(prev)
      ? mergeEntityArrays(prev, incoming, dedupeKey)
      : incoming;
  }

  return result;
};

const updateEntityInArray = (
  items: any[],
  data: Record<string, any>,
  dedupeKey: string
): { updated: boolean; items: any[] } => {
  let updated = false;
  const targetId = String(data[dedupeKey]);

  const newItems = items.map((item) => {
    if (item && typeof item === "object" && String(item[dedupeKey]) === targetId) {
      updated = true;
      return { ...item, ...filterSafeKeys(data) };
    }
    return item;
  });

  return { updated, items: newItems };
};

const updateInternalArray = (
  target: Record<string, any>,
  safeData: Record<string, any>,
  dedupeKey: string
): boolean => {
  for (const key of Object.keys(target)) {
    if (!Array.isArray(target[key])) {
      continue;
    }
    const { updated, items } = updateEntityInArray(target[key], safeData, dedupeKey);
    if (updated) {
      target[key] = items;
      return true;
    }
  }
  return false;
};

export const updateEntityInPlace = (
  prevContent: Record<string, any>,
  data: any,
  dedupeKey: string
): Record<string, any> => {
  if (!data || typeof data !== "object") {
    return { ...prevContent };
  }

  const safeData = filterSafeKeys(data);
  if (Array.isArray(prevContent)) {
    return updateEntityInArray(prevContent, safeData, dedupeKey).items;
  }

  const result: Record<string, any> = filterSafeKeys(prevContent);
  const targetId = safeData[dedupeKey] !== undefined ? String(safeData[dedupeKey]) : null;

  if (targetId && String(result[dedupeKey]) === targetId) {
    return { ...result, ...safeData };
  }

  updateInternalArray(result, safeData, dedupeKey);
  return result;
};

export const createCanvasReducer = <TContentMap extends Record<string, unknown>>() => {
  return (
    currentState: CanvasState<TContentMap> | null | undefined,
    envelope: ToolExecutionEnvelope<unknown, Extract<keyof TContentMap, string>>
  ): CanvasState<TContentMap> => {
    const { kind, mergeStrategy, dedupeKey = "id", data, uiIntent } = envelope;
    const prevContent = currentState?.content;

    if (!prevContent || prevContent.kind !== kind || mergeStrategy === "REPLACE") {
      return {
        content: { kind, ...filterSafeKeys((data as any) || {}) } as any,
        activeIntent: uiIntent,
      };
    }

    if (mergeStrategy === "APPEND_UNIQUE") {
      return {
        content: { kind, ...mergeUniqueEntities(prevContent, data, dedupeKey) } as any,
        activeIntent: uiIntent,
      };
    }

    if (mergeStrategy === "UPDATE_ENTITY") {
      return {
        content: { kind, ...updateEntityInPlace(prevContent, data, dedupeKey) } as any,
        activeIntent: uiIntent,
      };
    }

    return {
      content: prevContent,
      activeIntent: uiIntent ?? currentState?.activeIntent,
    };
  };
};
