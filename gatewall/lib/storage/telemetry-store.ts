import {
  SessionRun,
  ApprovalItem,
  ToolHealthMetric,
  FinOpsSummary,
  TelemetryIngestPayload,
  ToolExecutionEvent,
  StepApprovalRequestEvent,
  UserFeedbackEvent,
} from "../types/telemetry";
import { calculateFallbackTokenCost } from "../finops/fallback-cost-calculator";
import { detectInfiniteLoop } from "../finops/loop-shield";
import {
  loadPersistedSessions,
  persistSession,
  loadPersistedApprovals,
  persistApproval,
} from "./sqlite-driver";
import { getMockSessions, getMockApprovals } from "./mock-data";
import { sanitizeErrorMessage, extractBearerToken, formatDate } from "../utils";

export { sanitizeErrorMessage };

class TelemetryStore {
  private sessions: Map<string, SessionRun> = new Map();
  private approvals: Map<string, ApprovalItem> = new Map();
  private apiKeys: Set<string> = new Set([
    "gw_live_dev_test_key_123456789",
    "gw_pub_prospect_ai_123456789",
    "ag_live_dev_test_key_123456789",
    "ag_pub_dev_test_key_123456789",
  ]);

  constructor() {
    this.initStore();
  }

  private initStore(): void {
    const isDemoMode =
      process.env.GATEWALL_DEMO_MODE === "true" ||
      process.env.NEXT_PUBLIC_GATEWALL_DEMO_MODE === "true";

    const existingSessions = loadPersistedSessions();
    const existingApprovals = loadPersistedApprovals();

    if (existingSessions.length > 0 && !isDemoMode) {
      for (const s of existingSessions) {
        this.sessions.set(s.runId, s);
      }
      for (const a of existingApprovals) {
        this.approvals.set(a.id, a);
      }
    } else {
      this.seedInitialData();
      for (const s of this.sessions.values()) {
        persistSession(s);
      }
      for (const a of this.approvals.values()) {
        persistApproval(a);
      }
    }

    // Active TTL check on startup
    this.cleanExpiredApprovals();
  }

  public validateApiKey(authHeader: string | null): boolean {
    const token = extractBearerToken(authHeader);
    if (!token) return false;
    if (this.apiKeys.has(token)) return true;
    return (
      token.startsWith("gw_live_") ||
      token.startsWith("gw_pub_") ||
      token.startsWith("ag_live_") ||
      token.startsWith("ag_pub_")
    );
  }

  public getSessions(): SessionRun[] {
    this.cleanExpiredApprovals();
    const persisted = loadPersistedSessions();
    for (const s of persisted) {
      this.sessions.set(s.runId, s);
    }
    return Array.from(this.sessions.values()).sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
  }

  public getSessionById(runId: string): SessionRun | undefined {
    this.cleanExpiredApprovals();
    if (!this.sessions.has(runId)) {
      const persisted = loadPersistedSessions();
      for (const s of persisted) {
        this.sessions.set(s.runId, s);
      }
    }
    return this.sessions.get(runId);
  }

  public getSession(runId: string): SessionRun | undefined {
    return this.getSessionById(runId);
  }

  public getApprovals(): ApprovalItem[] {
    this.cleanExpiredApprovals();
    const persisted = loadPersistedApprovals();
    for (const a of persisted) {
      this.approvals.set(a.id, a);
    }
    return Array.from(this.approvals.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  public decideApproval(
    id: string,
    decision: "APPROVED" | "REJECTED",
    decidedBy = "Admin",
    reason?: string
  ): ApprovalItem | null {
    const item = this.approvals.get(id);
    if (!item) return null;
    item.status = decision;
    item.decidedAt = new Date().toISOString();
    item.decidedBy = decidedBy;
    item.reason = reason;
    this.approvals.set(id, item);
    persistApproval(item);

    const session = this.sessions.get(item.runId);
    if (session && session.status === "WAITING_APPROVAL") {
      session.status = decision === "APPROVED" ? "RUNNING" : "FAILED";
      this.sessions.set(item.runId, session);
      persistSession(session);
    }
    return item;
  }

  public cleanExpiredApprovals(maxAgeMs = 24 * 3600 * 1000): ApprovalItem[] {
    const now = Date.now();
    const expired: ApprovalItem[] = [];

    for (const [id, item] of this.approvals.entries()) {
      if (item.status === "PENDING") {
        const createdAtMs = new Date(item.createdAt).getTime();
        if (now - createdAtMs > maxAgeMs) {
          item.status = "REJECTED";
          item.decidedAt = new Date().toISOString();
          item.decidedBy = "System (TTL)";
          item.reason = "Auto-expired: SLA timeout exceeded (24h)";
          this.approvals.set(id, item);
          persistApproval(item);

          const session = this.sessions.get(item.runId);
          if (session && session.status === "WAITING_APPROVAL") {
            session.status = "FAILED";
            this.sessions.set(item.runId, session);
            persistSession(session);
          }

          expired.push(item);
        }
      }
    }

    return expired;
  }

  public ingest(payload: TelemetryIngestPayload): SessionRun {
    const existing = this.sessions.get(payload.runId);
    const toolEvents = payload.events.filter(
      (e) => e.type === "TOOL_EXECUTION"
    ) as ToolExecutionEvent[];

    // Sanitize any sensitive tokens / keys out of retriedErrors
    for (const t of toolEvents) {
      if (t.retriedErrors && Array.isArray(t.retriedErrors)) {
        t.retriedErrors = t.retriedErrors.map(sanitizeErrorMessage);
      }
    }

    const loopResult = detectInfiniteLoop(toolEvents);
    const approvalReq = payload.events.find(
      (e): e is StepApprovalRequestEvent => e.type === "STEP_APPROVAL_REQUEST"
    );

    const clientSecurityAlerts = payload.events.filter(
      (e) => e.type === "CLIENT_SECURITY_ALERT"
    );
    const clientRenders = payload.events.filter(
      (e) => e.type === "CLIENT_DATA_RENDERED"
    );
    const feedbackEvent = payload.events.find(
      (e): e is UserFeedbackEvent => e.type === "USER_FEEDBACK"
    );

    let status: SessionRun["status"] = existing?.status || "RUNNING";
    const hasFailedStep = payload.events.some((e) => e.type === "STEP_FAILED");
    const hasFailedTool = toolEvents.some(
      (t) => t.success === false && (t.attempts === undefined || t.attempts >= (t.maxRetries || 1))
    );

    if (approvalReq) {
      status = "WAITING_APPROVAL";
      const approvalId = `appr_${payload.runId}_${Date.now()}`;
      if (!this.approvals.has(approvalId)) {
        const newApproval: ApprovalItem = {
          id: approvalId,
          runId: payload.runId,
          agentName: payload.agentName,
          stepName: approvalReq.stepName,
          actionType: approvalReq.actionType || "CRITICAL_ACTION",
          payloadSummary: approvalReq.payloadSummary || {},
          status: "PENDING",
          createdAt: new Date().toISOString(),
        };
        this.approvals.set(approvalId, newApproval);
        persistApproval(newApproval);
      }
    } else if (hasFailedStep || hasFailedTool) {
      status = "FAILED";
    } else if (payload.events.some((e) => e.type === "STEP_COMPLETED")) {
      status = "COMPLETED";
    }

    const hasRetriesOccurred =
      Boolean(existing?.hasRetriesOccurred) ||
      toolEvents.some((t) => (t.attempts || 1) > 1);

    const currentTenantId = payload.tenantId || (payload.metadata?.tenantId as string | undefined);
    const currentTaskId = payload.taskId || (payload.metadata?.taskId as string | undefined);

    const retryOf = payload.metadata?.retryOf;
    if (retryOf) {
      const parentSession = this.sessions.get(retryOf);
      if (parentSession) {
        // Validation conjointe de sécurité (Anti-BOLA & Anti-Confusion Sémantique)
        const parentTenantId = parentSession.tenantId || (parentSession.metadata?.tenantId as string | undefined);
        const parentTaskId = parentSession.taskId || (parentSession.metadata?.taskId as string | undefined);

        const isTenantMatch = !parentTenantId || (currentTenantId !== undefined && parentTenantId === currentTenantId);
        const isTaskMatch = !parentTaskId || (currentTaskId !== undefined && parentTaskId === currentTaskId);
        const isAgentMatch = parentSession.agentName === payload.agentName;

        const isAuthorizedReplay = isTenantMatch && isTaskMatch && isAgentMatch;

        if (!isAuthorizedReplay) {
          console.warn(
            `[SECURITY ALERT] Unauthorized replay link attempt blocked: runId=${payload.runId} targeting parent=${retryOf} ` +
            `(Tenant match: ${isTenantMatch}, Task match: ${isTaskMatch}, Agent match: ${isAgentMatch})`
          );
        } else {
          parentSession.metadata = {
            ...(parentSession.metadata || {}),
            replayedBy: payload.runId,
          };
          parentSession.replayedBy = payload.runId;
          if (status === "COMPLETED") {
            parentSession.status = "RECOVERED";
          } else if (status === "FAILED") {
            parentSession.status = "FAILED";
          } else {
            parentSession.status = "RETRYING";
          }
          this.sessions.set(retryOf, parentSession);
          persistSession(parentSession);
        }
      }
    }

    const modelName = payload.usage?.model || existing?.model || "gpt-4o-mini";
    const promptTokens = payload.usage?.promptTokens || 0;
    const completionTokens = payload.usage?.completionTokens || 0;
    const totalTokens = payload.usage?.totalTokens || promptTokens + completionTokens;
    const costUsd =
      payload.usage?.costUsd !== undefined
        ? payload.usage.costUsd
        : calculateFallbackTokenCost(modelName, promptTokens, completionTokens);

    const piiFiltered = toolEvents.reduce((acc, t) => acc + (t.piiFilteredCount || 0), 0);
    const lastToolWithRetries = [...toolEvents].reverse().find((t) => t.retriedErrors && t.retriedErrors.length > 0);
    const finalRetriedErrors = lastToolWithRetries?.retriedErrors || existing?.retriedErrors;

    const sessionRun: SessionRun = {
      id: payload.runId,
      runId: payload.runId,
      agentName: payload.agentName,
      tenantId: currentTenantId || existing?.tenantId,
      taskId: currentTaskId || existing?.taskId,
      status,
      startTime: existing?.startTime || payload.timestamp || new Date().toISOString(),
      endTime: status === "COMPLETED" || status === "RECOVERED" ? new Date().toISOString() : undefined,
      durationMs:
        (existing?.durationMs || 0) +
        (toolEvents.reduce((acc, t) => acc + (t.durationMs || 0), 0) || 500),
      totalCostUsd: Number(((existing?.totalCostUsd || 0) + costUsd).toFixed(6)),
      totalTokens: (existing?.totalTokens || 0) + totalTokens,
      promptTokens: (existing?.promptTokens || 0) + promptTokens,
      completionTokens: (existing?.completionTokens || 0) + completionTokens,
      model: modelName,
      eventsCount: (existing?.eventsCount || 0) + payload.events.length,
      toolsUsedCount: (existing?.toolsUsedCount || 0) + toolEvents.length,
      piiFilteredCount: (existing?.piiFilteredCount || 0) + piiFiltered,
      loopAlertTriggered: loopResult.isLoopDetected || Boolean(existing?.loopAlertTriggered),
      clientSecurityAlertsCount:
        (existing?.clientSecurityAlertsCount || 0) + clientSecurityAlerts.length,
      clientDataRenderedCount:
        (existing?.clientDataRenderedCount || 0) + clientRenders.length,
      hasRetriesOccurred,
      retriedErrors: finalRetriedErrors,
      metadata: payload.metadata || existing?.metadata,
      userFeedback: feedbackEvent
        ? {
            rating: feedbackEvent.rating,
            tag: feedbackEvent.feedbackTag,
            comment: feedbackEvent.userComment,
          }
        : existing?.userFeedback,
      events: existing ? [...existing.events, ...payload.events] : payload.events,
    };

    this.sessions.set(payload.runId, sessionRun);
    persistSession(sessionRun);
    return sessionRun;
  }

  public getFinOpsSummary(): FinOpsSummary {
    const runs = this.getSessions();
    const totalCostUsd = runs.reduce((acc, r) => acc + r.totalCostUsd, 0);
    const totalTokens = runs.reduce((acc, r) => acc + r.totalTokens, 0);
    const uniqueAgents = new Set(runs.map((r) => r.agentName)).size;

    const costByModel: Record<string, { costUsd: number; tokens: number; count: number }> = {};
    for (const run of runs) {
      if (!costByModel[run.model]) {
        costByModel[run.model] = { costUsd: 0, tokens: 0, count: 0 };
      }
      costByModel[run.model].costUsd += run.totalCostUsd;
      costByModel[run.model].tokens += run.totalTokens;
      costByModel[run.model].count += 1;
    }

    const dailyMap: Record<string, { costUsd: number; tokens: number; runs: number }> = {};
    for (const run of runs) {
      const date = formatDate(run.startTime);
      if (!dailyMap[date]) {
        dailyMap[date] = { costUsd: 0, tokens: 0, runs: 0 };
      }
      dailyMap[date].costUsd += run.totalCostUsd;
      dailyMap[date].tokens += run.totalTokens;
      dailyMap[date].runs += 1;
    }

    const dailyHistory = Object.entries(dailyMap).map(([date, val]) => ({
      date,
      costUsd: Number(val.costUsd.toFixed(4)),
      tokens: val.tokens,
      runs: val.runs,
    }));

    return {
      totalCostUsd: Number(totalCostUsd.toFixed(4)),
      totalTokens,
      totalRuns: runs.length,
      activeAgentsCount: uniqueAgents,
      costByModel,
      dailyHistory: dailyHistory.length > 0 ? dailyHistory : [
        { date: "2026-09-11", costUsd: 0.12, tokens: 42000, runs: 14 },
        { date: "2026-09-12", costUsd: 0.28, tokens: 98000, runs: 32 },
        { date: "2026-09-13", costUsd: 0.45, tokens: 165000, runs: 58 },
      ],
    };
  }

  public getToolHealthMetrics(): ToolHealthMetric[] {
    const toolMap: Record<
      string,
      { count: number; successes: number; durations: number[]; cost: number; loops: number; lastUsed: string }
    > = {};

    for (const session of this.sessions.values()) {
      for (const ev of session.events) {
        if (ev.type === "TOOL_EXECUTION") {
          if (!toolMap[ev.toolName]) {
            toolMap[ev.toolName] = {
              count: 0,
              successes: 0,
              durations: [],
              cost: 0,
              loops: 0,
              lastUsed: ev.timestamp,
            };
          }
          const item = toolMap[ev.toolName];
          item.count++;
          if (ev.success) item.successes++;
          item.durations.push(ev.durationMs || 0);
          item.cost += ev.costUsd || 0;
          if (session.loopAlertTriggered) item.loops++;
          if (new Date(ev.timestamp) > new Date(item.lastUsed)) {
            item.lastUsed = ev.timestamp;
          }
        }
      }
    }

    return Object.entries(toolMap).map(([toolName, stats]) => {
      const avgDuration = stats.durations.reduce((a, b) => a + b, 0) / (stats.durations.length || 1);
      const sorted = [...stats.durations].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)] || avgDuration;

      return {
        toolName,
        totalExecutions: stats.count,
        successRate: Number(((stats.successes / stats.count) * 100).toFixed(1)),
        avgDurationMs: Math.round(avgDuration),
        p95DurationMs: Math.round(p95),
        totalCostUsd: Number(stats.cost.toFixed(5)),
        loopShieldTriggers: stats.loops,
        lastUsedAt: stats.lastUsed,
      };
    });
  }

  public seedInitialData(): void {
    const mockSessions = getMockSessions();
    const mockApprovals = getMockApprovals();

    for (const s of mockSessions) {
      this.sessions.set(s.runId, s);
    }
    for (const a of mockApprovals) {
      this.approvals.set(a.id, a);
    }
  }
}

// Global singleton instance for the app
const globalForStore = globalThis as unknown as { telemetryStore: TelemetryStore | undefined };
export const telemetryStore = new TelemetryStore();
if (process.env.NODE_ENV !== "production") {
  globalForStore.telemetryStore = telemetryStore;
}
