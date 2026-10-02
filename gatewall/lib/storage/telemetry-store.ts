import {
  SessionRun,
  ApprovalItem,
  ToolHealthMetric,
  FinOpsSummary,
  TelemetryIngestPayload,
  ToolExecutionEvent,
  StepApprovalRequestEvent,
} from "../types/telemetry";
import { detectInfiniteLoop } from "../finops/loop-shield";
import {
  loadPersistedSessions,
  persistSession,
  loadPersistedApprovals,
  persistApproval,
} from "./sqlite-driver";
import { getMockSessions, getMockApprovals } from "./mock-data";
import { sanitizeErrorMessage, extractBearerToken, formatDate } from "../utils";
import {
  ONE_DAY_MS,
  MAX_PROCESSED_BATCHES,
  nowIso,
  add,
  sortByDateDesc,
  getEntityScope,
  resolveScope,
  extractUserFeedback,
  computeFinOpsUsage,
  accumulateMetrics,
} from "./telemetry-store-helpers";

export { sanitizeErrorMessage };

class TelemetryStore {
  private sessions: Map<string, SessionRun> = new Map();
  private approvals: Map<string, ApprovalItem> = new Map();
  private processedBatches: Map<string, { runId: string; timestamp: number }> = new Map();
  private apiKeys: Set<string> = new Set([
    "gw_live_dev_test_key_123456789",
    "gw_pub_prospect_ai_123456789",
    "ag_live_dev_test_key_123456789",
    "ag_pub_dev_test_key_123456789",
  ]);

  constructor() {
    this.initStore();
  }

  private syncPersistedSessions(): void {
    for (const s of loadPersistedSessions()) {
      this.sessions.set(s.runId, s);
    }
  }

  private syncPersistedApprovals(): void {
    for (const a of loadPersistedApprovals()) {
      this.approvals.set(a.id, a);
    }
  }

  private updateSessionStatus(
    runId: string,
    newStatus: SessionRun["status"],
    expectedCurrentStatus?: SessionRun["status"]
  ): void {
    const session = this.sessions.get(runId);
    if (!session || (expectedCurrentStatus && session.status !== expectedCurrentStatus)) {
      return;
    }
    session.status = newStatus;
    this.sessions.set(runId, session);
    persistSession(session);
  }

  private initStore(): void {
    const isDemoMode =
      process.env.GATEWALL_DEMO_MODE === "true" ||
      process.env.NEXT_PUBLIC_GATEWALL_DEMO_MODE === "true";

    const existingSessions = loadPersistedSessions();

    if (existingSessions.length > 0 && !isDemoMode) {
      this.syncPersistedSessions();
      this.syncPersistedApprovals();
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
    this.syncPersistedSessions();
    return sortByDateDesc(this.sessions.values(), (s) => s.startTime);
  }

  public getSessionById(runId: string): SessionRun | undefined {
    this.cleanExpiredApprovals();
    if (!this.sessions.has(runId)) {
      this.syncPersistedSessions();
    }
    return this.sessions.get(runId);
  }

  public getSession(runId: string): SessionRun | undefined {
    return this.getSessionById(runId);
  }

  public getApprovals(): ApprovalItem[] {
    this.cleanExpiredApprovals();
    this.syncPersistedApprovals();
    return sortByDateDesc(this.approvals.values(), (a) => a.createdAt);
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
    item.decidedAt = nowIso();
    item.decidedBy = decidedBy;
    item.reason = reason;
    this.approvals.set(id, item);
    persistApproval(item);

    this.updateSessionStatus(
      item.runId,
      decision === "APPROVED" ? "RUNNING" : "FAILED",
      "WAITING_APPROVAL"
    );
    return item;
  }

  public cleanExpiredApprovals(maxAgeMs = ONE_DAY_MS): ApprovalItem[] {
    const now = Date.now();
    const expired: ApprovalItem[] = [];

    for (const [id, item] of this.approvals.entries()) {
      if (item.status === "PENDING") {
        const createdAtMs = new Date(item.createdAt).getTime();
        if (now - createdAtMs > maxAgeMs) {
          item.status = "REJECTED";
          item.decidedAt = nowIso();
          item.decidedBy = "System (TTL)";
          item.reason = "Auto-expired: SLA timeout exceeded (24h)";
          this.approvals.set(id, item);
          persistApproval(item);

          this.updateSessionStatus(item.runId, "FAILED", "WAITING_APPROVAL");
          expired.push(item);
        }
      }
    }

    return expired;
  }

  private resolveExistingBatch(payload: TelemetryIngestPayload): SessionRun | undefined {
    if (!payload.batchId || !this.processedBatches.has(payload.batchId)) {
      return undefined;
    }
    return this.getSessionById(payload.runId);
  }

  private sanitizeToolEvents(events: TelemetryIngestPayload["events"]): ToolExecutionEvent[] {
    const toolEvents = events.filter(
      (e): e is ToolExecutionEvent => e.type === "TOOL_EXECUTION"
    );
    for (const t of toolEvents) {
      if (t.retriedErrors && Array.isArray(t.retriedErrors)) {
        t.retriedErrors = t.retriedErrors.map(sanitizeErrorMessage);
      }
    }
    return toolEvents;
  }

  private createApprovalItem(
    payload: TelemetryIngestPayload,
    approvalReq: StepApprovalRequestEvent
  ): void {
    const approvalId = `appr_${payload.runId}_${Date.now()}`;
    if (this.approvals.has(approvalId)) {
      return;
    }

    const newApproval: ApprovalItem = {
      id: approvalId,
      runId: payload.runId,
      agentName: payload.agentName,
      stepName: approvalReq.stepName,
      actionType: approvalReq.actionType || "CRITICAL_ACTION",
      payloadSummary: approvalReq.payloadSummary || {},
      status: "PENDING",
      createdAt: nowIso(),
    };
    this.approvals.set(approvalId, newApproval);
    persistApproval(newApproval);
  }

  private resolveSessionStatus(
    payload: TelemetryIngestPayload,
    toolEvents: ToolExecutionEvent[],
    existing?: SessionRun
  ): SessionRun["status"] {
    const approvalReq = payload.events.find(
      (e): e is StepApprovalRequestEvent => e.type === "STEP_APPROVAL_REQUEST"
    );
    if (approvalReq) {
      this.createApprovalItem(payload, approvalReq);
      return "WAITING_APPROVAL";
    }

    const hasFailedStep = payload.events.some((e) => e.type === "STEP_FAILED");
    const hasFailedTool = toolEvents.some(
      (t) => t.success === false && (t.attempts === undefined || t.attempts >= (t.maxRetries || 1))
    );
    if (hasFailedStep || hasFailedTool) {
      return "FAILED";
    }

    if (payload.events.some((e) => e.type === "STEP_COMPLETED")) {
      return "COMPLETED";
    }

    return existing?.status || "RUNNING";
  }

  private validateReplayAuthorization(
    payload: TelemetryIngestPayload,
    parent: SessionRun,
    retryOf: string
  ): boolean {
    const curTenant = getEntityScope(payload, "tenantId");
    const curTask = getEntityScope(payload, "taskId");
    const parTenant = getEntityScope(parent, "tenantId");
    const parTask = getEntityScope(parent, "taskId");

    const isTenantMatch = !parTenant || (curTenant !== undefined && parTenant === curTenant);
    const isTaskMatch = !parTask || (curTask !== undefined && parTask === curTask);
    const isAgentMatch = parent.agentName === payload.agentName;

    if (isTenantMatch && isTaskMatch && isAgentMatch) {
      return true;
    }

    console.warn(
      `[SECURITY ALERT] Unauthorized replay link attempt blocked: runId=${payload.runId} targeting parent=${retryOf}`
    );
    return false;
  }

  private linkReplayParent(payload: TelemetryIngestPayload, status: SessionRun["status"]): void {
    const retryOf = payload.metadata?.retryOf;
    if (!retryOf) return;

    const parent = this.sessions.get(retryOf);
    if (!parent) return;

    if (!this.validateReplayAuthorization(payload, parent, retryOf)) {
      return;
    }

    parent.metadata = { ...(parent.metadata || {}), replayedBy: payload.runId };
    parent.replayedBy = payload.runId;
    parent.status = status === "COMPLETED" ? "RECOVERED" : status === "FAILED" ? "FAILED" : "RETRYING";
    this.sessions.set(retryOf, parent);
    persistSession(parent);
  }

  private assembleSessionRun(
    payload: TelemetryIngestPayload,
    toolEvents: ToolExecutionEvent[],
    status: SessionRun["status"],
    existing?: SessionRun
  ): SessionRun {
    const usage = computeFinOpsUsage(payload, existing);
    const isFinished = status === "COMPLETED" || status === "RECOVERED";
    const lastTool = [...toolEvents].reverse().find((t) => t.retriedErrors && t.retriedErrors.length > 0);

    return {
      id: payload.runId,
      runId: payload.runId,
      agentName: payload.agentName,
      tenantId: resolveScope(payload, existing, "tenantId"),
      taskId: resolveScope(payload, existing, "taskId"),
      status,
      startTime: existing?.startTime || payload.timestamp || nowIso(),
      endTime: isFinished ? nowIso() : undefined,
      model: usage.model,
      loopAlertTriggered: detectInfiniteLoop(toolEvents).isLoopDetected || Boolean(existing?.loopAlertTriggered),
      hasRetriesOccurred: Boolean(existing?.hasRetriesOccurred) || toolEvents.some((t) => (t.attempts || 1) > 1),
      retriedErrors: lastTool?.retriedErrors || existing?.retriedErrors,
      metadata: payload.metadata || existing?.metadata,
      userFeedback: extractUserFeedback(payload.events, existing?.userFeedback),
      events: existing ? [...existing.events, ...payload.events] : payload.events,
      ...accumulateMetrics(existing, payload, toolEvents, usage),
    };
  }

  private recordProcessedBatch(batchId?: string, runId?: string): void {
    if (!batchId || !runId) return;

    this.processedBatches.set(batchId, { runId, timestamp: Date.now() });
    if (this.processedBatches.size <= MAX_PROCESSED_BATCHES) return;

    const threshold = Date.now() - ONE_DAY_MS;
    for (const [id, meta] of this.processedBatches.entries()) {
      if (meta.timestamp < threshold) {
        this.processedBatches.delete(id);
      }
    }
  }

  public ingest(payload: TelemetryIngestPayload): SessionRun {
    const cached = this.resolveExistingBatch(payload);
    if (cached) {
      return cached;
    }

    const existing = this.sessions.get(payload.runId);
    const toolEvents = this.sanitizeToolEvents(payload.events);
    const status = this.resolveSessionStatus(payload, toolEvents, existing);

    this.linkReplayParent(payload, status);

    const sessionRun = this.assembleSessionRun(payload, toolEvents, status, existing);
    this.sessions.set(payload.runId, sessionRun);
    persistSession(sessionRun);
    this.recordProcessedBatch(payload.batchId, payload.runId);

    return sessionRun;
  }

  public isBatchProcessed(batchId: string): boolean {
    return this.processedBatches.has(batchId);
  }

  public clearProcessedBatches(): void {
    this.processedBatches.clear();
  }

  public getFinOpsSummary(): FinOpsSummary {
    const runs = this.getSessions();
    const totalCostUsd = runs.reduce((acc, r) => acc + r.totalCostUsd, 0);
    const totalTokens = runs.reduce((acc, r) => acc + r.totalTokens, 0);
    const uniqueAgents = new Set(runs.map((r) => r.agentName)).size;

    const costByModel: Record<string, { costUsd: number; tokens: number; count: number }> = {};
    const dailyMap: Record<string, { costUsd: number; tokens: number; runs: number }> = {};

    for (const run of runs) {
      if (!costByModel[run.model]) {
        costByModel[run.model] = { costUsd: 0, tokens: 0, count: 0 };
      }
      costByModel[run.model].costUsd += run.totalCostUsd;
      costByModel[run.model].tokens += run.totalTokens;
      costByModel[run.model].count += 1;

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
      const avgDuration = stats.durations.reduce(add, 0) / (stats.durations.length || 1);
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
