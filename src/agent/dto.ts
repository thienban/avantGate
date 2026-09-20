/**
 * Declarative DTO Projection Helpers for avantgate/agent.
 * Standardizes common tool output projections (booleans, count, field pick, exhaustive projection)
 * to minimize LLM token consumption, prevent PII leakage, and guard against schema drift.
 */

export interface DtoBooleanResult {
  success: boolean;
}

export interface DtoCountResult {
  success: true;
  count: number;
}

/**
 * Type Guard ensuring compile-time exhaustiveness for DTO projections.
 * Requires every key of TSource to be explicitly assigned to either 'keep' or 'drop'.
 * Emits descriptive type errors (_unassignedSourceFields or _overlappingFields) upon discrepancy.
 */
export type ExhaustiveProjectionConfig<
  TSource,
  TKeep extends keyof TSource,
  TDrop extends keyof TSource
> = [Exclude<keyof TSource, TKeep | TDrop>] extends [never]
  ? [Extract<TKeep, TDrop>] extends [never]
    ? {
        keep: readonly TKeep[];
        drop: readonly TDrop[];
      }
    : {
        keep: readonly TKeep[];
        drop: readonly TDrop[];
        /** ❌ Compile Error: A field cannot be present in both 'keep' and 'drop' */
        _overlappingFields: Extract<TKeep, TDrop>;
      }
  : {
      keep: readonly TKeep[];
      drop: readonly TDrop[];
      /** ❌ Compile Error: Unassigned source fields! You must explicitly add these keys to either 'keep' or 'drop' */
      _unassignedSourceFields: Exclude<keyof TSource, TKeep | TDrop>;
    };

function extractWhitelistedFields<TSource, K extends keyof TSource>(
  data: TSource,
  keys: readonly K[] | K[]
): Pick<TSource, K> {
  const result = {} as Pick<TSource, K>;
  if (!data || typeof data !== "object") {
    return result;
  }
  for (const key of keys) {
    if (key in data) {
      (result as any)[key] = (data as any)[key];
    }
  }
  return result;
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
   * Filters raw output by extracting only a whitelist of allowed fields.
   * Supports optional TSource generic parameter for auto-completion.
   */
  pick:
    <TSource = any, K extends keyof TSource = any>(keys: readonly K[] | K[]) =>
    (data: TSource): Pick<TSource, K> =>
      extractWhitelistedFields(data, keys),

  /**
   * Compile-time guarded exhaustive projection.
   * Forces developers to explicitly classify every key of TSource as either 'keep' (sent to LLM)
   * or 'drop' (ignored), preventing silent schema drift when source types evolve.
   */
  exhaustivePick:
    <TSource>() =>
    <const TKeep extends keyof TSource, const TDrop extends keyof TSource>(
      config: ExhaustiveProjectionConfig<TSource, TKeep, TDrop>
    ) =>
    (data: TSource): Pick<TSource, TKeep> =>
      extractWhitelistedFields(data, config.keep),
};


