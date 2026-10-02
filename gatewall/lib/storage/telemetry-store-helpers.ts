import {
  RunEvent,
  SessionRun,
  TelemetryIngestPayload,
  ToolExecutionEvent,
  UserFeedbackEvent,
} from "../types/telemetry";
import { calculateFallbackTokenCost } from "../finops/fallback-cost-calculator";

export const ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_PROCESSED_BATCHES = 10_000;
export const DEFAULT_MODEL = "gpt-4o-mini";
export const DEFAULT_TOOL_DURATION_MS = 500;

export const nowIso = (): string => new Date().toISOString();

export const add = (prev = 0, delta = 0): number => prev + delta;

export const sortByDateDesc = <T>(items: Iterable<T>, getDateStr: (item: T) => string): T[] =>
  Array.from(items).sort(
    (a, b) => new Date(getDateStr(b)).getTime() - new Date(getDateStr(a)).getTime()
  );

export type ScopedEntity = {
  tenantId?: string;
  taskId?: string;
  metadata?: { tenantId?: string; taskId?: string; [key: string]: unknown };
};

export const getEntityScope = (
  entity: ScopedEntity | undefined,
  key: "tenantId" | "taskId"
): string | undefined => entity?.[key] ?? (entity?.metadata?.[key] as string | undefined);

export const resolveScope = (
  payload: TelemetryIngestPayload,
  existing: SessionRun | undefined,
  key: "tenantId" | "taskId"
): string | undefined => getEntityScope(payload, key) ?? getEntityScope(existing, key);

export const extractUserFeedback = (
  events: RunEvent[],
  existing?: SessionRun["userFeedback"]
): SessionRun["userFeedback"] => {
  const ev = events.find((e): e is UserFeedbackEvent => e.type === "USER_FEEDBACK");
  return ev ? { rating: ev.rating, tag: ev.feedbackTag, comment: ev.userComment } : existing;
};

export const computeFinOpsUsage = (
  payload: TelemetryIngestPayload,
  existing?: SessionRun
) => {
  const model = payload.usage?.model || existing?.model || DEFAULT_MODEL;
  const promptTokens = payload.usage?.promptTokens || 0;
  const completionTokens = payload.usage?.completionTokens || 0;
  const totalTokens = payload.usage?.totalTokens || promptTokens + completionTokens;
  const costUsd =
    payload.usage?.costUsd !== undefined
      ? payload.usage.costUsd
      : calculateFallbackTokenCost(model, promptTokens, completionTokens);

  return { model, promptTokens, completionTokens, totalTokens, costUsd };
};

export const accumulateMetrics = (
  existing: SessionRun | undefined,
  payload: TelemetryIngestPayload,
  toolEvents: ToolExecutionEvent[],
  usage: ReturnType<typeof computeFinOpsUsage>
) => {
  const countType = (type: RunEvent["type"]) =>
    payload.events.filter((e) => e.type === type).length;
  const toolDurations =
    toolEvents.reduce((acc, t) => acc + (t.durationMs || 0), 0) ||
    DEFAULT_TOOL_DURATION_MS;
  const piiFiltered = toolEvents.reduce(
    (acc, t) => acc + (t.piiFilteredCount || 0),
    0
  );

  return {
    durationMs: add(existing?.durationMs, toolDurations),
    totalCostUsd: Number(add(existing?.totalCostUsd, usage.costUsd).toFixed(6)),
    totalTokens: add(existing?.totalTokens, usage.totalTokens),
    promptTokens: add(existing?.promptTokens, usage.promptTokens),
    completionTokens: add(existing?.completionTokens, usage.completionTokens),
    eventsCount: add(existing?.eventsCount, payload.events.length),
    toolsUsedCount: add(existing?.toolsUsedCount, toolEvents.length),
    piiFilteredCount: add(existing?.piiFilteredCount, piiFiltered),
    clientSecurityAlertsCount: add(
      existing?.clientSecurityAlertsCount,
      countType("CLIENT_SECURITY_ALERT")
    ),
    clientDataRenderedCount: add(
      existing?.clientDataRenderedCount,
      countType("CLIENT_DATA_RENDERED")
    ),
  };
};
