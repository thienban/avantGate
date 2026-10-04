export type ToolMergeStrategy = "REPLACE" | "APPEND_UNIQUE" | "UPDATE_ENTITY";

export type UIIntentAction = "HIGHLIGHT" | "SELECT" | "OPEN_MODAL" | "NAVIGATE";

export interface UIIntent {
  action: UIIntentAction;
  targetId: string;
  targetType: "prospect" | "company" | "task" | "event" | string;
  metadata?: Record<string, unknown>;
}

export interface ToolExecutionEnvelope<TPayload = unknown, TKind extends string = string> {
  readonly version: 1;
  readonly toolId: string;
  readonly kind: TKind;
  readonly mergeStrategy: ToolMergeStrategy;
  readonly dedupeKey?: string;
  readonly uiIntent?: UIIntent;
  readonly data: TPayload;
}

export const createToolEnvelope = <TKind extends string, TPayload>(
  options: Omit<ToolExecutionEnvelope<TPayload, TKind>, "version">
): ToolExecutionEnvelope<TPayload, TKind> => {
  return Object.freeze({
    version: 1,
    ...options,
  });
};
