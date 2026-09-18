/**
 * Declarative DTO Projection Helpers for avantgate/agent.
 * Standardizes common tool output projections (booleans, count, field pick)
 * to minimize LLM token consumption and prevent PII leakage.
 */

export interface DtoBooleanResult {
  success: boolean;
}

export interface DtoCountResult {
  success: true;
  count: number;
}

export const dto = {
  /**
   * Generates a boolean acknowledgment for mutations ({ success: true | false }).
   * If rawResult contains a boolean `success` property, it is preserved; otherwise defaults to true.
   */
  boolean: () => (data: any): DtoBooleanResult => ({
    success: typeof data?.success === "boolean" ? data.success : true,
  }),

  /**
   * Generates a boolean acknowledgment preserving an opaque technical identifier for tool chaining.
   */
  booleanWithId: <K extends string = "id">(idKey: K = "id" as K) =>
    (data: any): DtoBooleanResult & Record<K, unknown> =>
      ({
        success: typeof data?.success === "boolean" ? data.success : true,
        [idKey]: data?.[idKey],
      }) as DtoBooleanResult & Record<K, unknown>,

  /**
   * Extracts a numeric count from a list or nested array property without exposing items to the LLM.
   */
  count:
    (arrayKey?: string) =>
    (data: any): DtoCountResult => {
      const list = arrayKey ? data?.[arrayKey] : data;
      return {
        success: true,
        count: Array.isArray(list) ? list.length : 0,
      };
    },

  /**
   * Filters raw output by extracting only a strict whitelist of allowed fields.
   */
  pick:
    <T extends string>(keys: readonly T[] | T[]) =>
    (data: any): Record<T, unknown> => {
      const result = {} as Record<T, unknown>;
      if (!data || typeof data !== "object") {
        return result;
      }
      for (const key of keys) {
        if (key in data) {
          result[key] = data[key];
        }
      }
      return result;
    },
};
