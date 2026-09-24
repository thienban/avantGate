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
    const existingSessions = loadPersistedSessions();
    const existingApprovals = loadPersistedApprovals();

    if (existingSessions.length > 0) {
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
  }

  public validateApiKey(authHeader: string | null): boolean {
    if (!authHeader) return false;
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (this.apiKeys.has(token)) return true;
    return (
      token.startsWith("gw_live_") ||
      token.startsWith("gw_pub_") ||
      token.startsWith("ag_live_") ||
      token.startsWith("ag_pub_")
    );
  }

  public getSessions(): SessionRun[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
  }

  public getSessionById(runId: string): SessionRun | undefined {
    return this.sessions.get(runId);
  }

  public getApprovals(): ApprovalItem[] {
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

  public ingest(payload: TelemetryIngestPayload): SessionRun {
    const existing = this.sessions.get(payload.runId);
    const toolEvents = payload.events.filter(
      (e) => e.type === "TOOL_EXECUTION"
    ) as ToolExecutionEvent[];

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
    } else if (payload.events.some((e) => e.type === "STEP_COMPLETED")) {
      status = "COMPLETED";
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

    const sessionRun: SessionRun = {
      id: payload.runId,
      runId: payload.runId,
      agentName: payload.agentName,
      status,
      startTime: existing?.startTime || payload.timestamp || new Date().toISOString(),
      endTime: status === "COMPLETED" ? new Date().toISOString() : undefined,
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
      const date = run.startTime.slice(0, 10);
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

  private seedInitialData(): void {
    const run1: SessionRun = {
      id: "run-prospect-101",
      runId: "run-prospect-101",
      agentName: "prospect-qualifier",
      status: "WAITING_APPROVAL",
      startTime: "2026-09-13T13:40:00.000Z",
      durationMs: 1420,
      totalCostUsd: 0.000459,
      totalTokens: 1750,
      promptTokens: 1350,
      completionTokens: 400,
      model: "gpt-4o-mini",
      eventsCount: 4,
      toolsUsedCount: 1,
      piiFilteredCount: 3,
      loopAlertTriggered: false,
      clientSecurityAlertsCount: 0,
      clientDataRenderedCount: 1,
      userFeedback: {
        rating: "POSITIVE",
        tag: "HELPFUL",
        comment: "Directeurs pertinents identifiés sans exposer d'emails confidentiels.",
      },
      events: [
        {
          type: "STEP_START",
          stepName: "fetch-prospect-data",
          timestamp: "2026-09-13T13:40:01.000Z",
        },
        {
          type: "TOOL_EXECUTION",
          toolId: "crm_lookup_01",
          toolName: "searchCRM",
          aliasUsed: "lookup_crm",
          depth: 1,
          durationMs: 340,
          success: true,
          llmSummary: { found: true, leadScore: 85, company: "Acme Corp" },
          rawPayload: { email: "ceo@acme.com", phone: "+33612345678", revenue: "$10M" },
          piiFilteredCount: 3,
          tokens: { promptTokens: 120, completionTokens: 60, totalTokens: 180 },
          costUsd: 0.00008,
          cached: false,
          timestamp: "2026-09-13T13:40:01.340Z",
        },
        {
          type: "CLIENT_DATA_RENDERED",
          toolId: "crm_lookup_01",
          channel: "HTTP",
          renderedItemCount: 1,
          timestamp: "2026-09-13T13:40:01.380Z",
        },
        {
          type: "STEP_COMPLETED",
          stepName: "fetch-prospect-data",
          durationMs: 420,
          piiDetectedCount: 3,
          resultSummary: { success: true },
          timestamp: "2026-09-13T13:40:01.420Z",
        },
        {
          type: "STEP_APPROVAL_REQUEST",
          stepName: "send-outreach-email",
          actionType: "SEND_OUTREACH_EMAIL",
          payloadSummary: {
            recipientDomain: "acme.com",
            template: "executive_pitch",
            leadScore: 85,
            channel: "Email",
          },
          timestamp: "2026-09-13T13:40:02.000Z",
        },
        {
          type: "USER_FEEDBACK",
          rating: "POSITIVE",
          feedbackTag: "HELPFUL",
          userComment: "Directeurs pertinents identifiés sans exposer d'emails confidentiels.",
          timestamp: "2026-09-13T13:40:03.500Z",
        },
      ],
    };

    const run2: SessionRun = {
      id: "run-enrich-202",
      runId: "run-enrich-202",
      agentName: "lead-enricher",
      status: "COMPLETED",
      startTime: "2026-09-13T12:15:00.000Z",
      endTime: "2026-09-13T12:15:03.200Z",
      durationMs: 3200,
      totalCostUsd: 0.00185,
      totalTokens: 4600,
      promptTokens: 3800,
      completionTokens: 800,
      model: "claude-3-5-sonnet-20241022",
      eventsCount: 4,
      toolsUsedCount: 2,
      piiFilteredCount: 5,
      loopAlertTriggered: false,
      clientSecurityAlertsCount: 0,
      clientDataRenderedCount: 2,
      events: [
        {
          type: "STEP_START",
          stepName: "enrich-linkedin-profile",
          timestamp: "2026-09-13T12:15:00.500Z",
        },
        {
          type: "TOOL_EXECUTION",
          toolId: "linkedin_01",
          toolName: "scrapeCompanyData",
          aliasUsed: "fetch_company",
          depth: 1,
          durationMs: 890,
          success: true,
          llmSummary: { employeesCount: 250, industry: "Fintech", hq: "Paris" },
          rawPayload: { executiveName: "Alice Martin", directPhone: "+33140506070" },
          piiFilteredCount: 2,
          tokens: { promptTokens: 350, completionTokens: 120, totalTokens: 470 },
          costUsd: 0.00045,
          cached: false,
          timestamp: "2026-09-13T12:15:01.390Z",
        },
        {
          type: "CLIENT_DATA_RENDERED",
          toolId: "linkedin_01",
          channel: "HTTP",
          renderedItemCount: 2,
          timestamp: "2026-09-13T12:15:01.410Z",
        },
        {
          type: "STEP_COMPLETED",
          stepName: "enrich-linkedin-profile",
          durationMs: 950,
          piiDetectedCount: 2,
          resultSummary: { verified: true },
          timestamp: "2026-09-13T12:15:01.450Z",
        },
      ],
    };

    const run3: SessionRun = {
      id: "run-loop-guard-303",
      runId: "run-loop-guard-303",
      agentName: "support-resolver",
      status: "FAILED",
      startTime: "2026-09-13T11:00:00.000Z",
      endTime: "2026-09-13T11:00:04.100Z",
      durationMs: 4100,
      totalCostUsd: 0.00092,
      totalTokens: 2900,
      promptTokens: 2500,
      completionTokens: 400,
      model: "gpt-4o-mini",
      eventsCount: 4,
      toolsUsedCount: 3,
      piiFilteredCount: 0,
      loopAlertTriggered: true,
      clientSecurityAlertsCount: 0,
      clientDataRenderedCount: 0,
      events: [
        {
          type: "STEP_START",
          stepName: "ticket-lookup-step",
          timestamp: "2026-09-13T11:00:00.100Z",
        },
        {
          type: "TOOL_EXECUTION",
          toolId: "zendesk_01",
          toolName: "fetchTicketInfo",
          aliasUsed: "zendesk_api",
          depth: 1,
          durationMs: 250,
          success: true,
          llmSummary: { ticketId: 994, status: "open" },
          piiFilteredCount: 0,
          costUsd: 0.00005,
          cached: false,
          timestamp: "2026-09-13T11:00:01.000Z",
        },
        {
          type: "TOOL_EXECUTION",
          toolId: "zendesk_02",
          toolName: "fetchTicketInfo",
          aliasUsed: "zendesk_api",
          depth: 1,
          durationMs: 240,
          success: true,
          llmSummary: { ticketId: 994, status: "open" },
          piiFilteredCount: 0,
          costUsd: 0.00005,
          cached: false,
          timestamp: "2026-09-13T11:00:01.500Z",
        },
        {
          type: "TOOL_EXECUTION",
          toolId: "zendesk_03",
          toolName: "fetchTicketInfo",
          aliasUsed: "zendesk_api",
          depth: 1,
          durationMs: 260,
          success: true,
          llmSummary: { ticketId: 994, status: "open" },
          piiFilteredCount: 0,
          costUsd: 0.00005,
          cached: false,
          timestamp: "2026-09-13T11:00:02.000Z",
        },
      ],
    };

    const run4: SessionRun = {
      id: "run-threat-404",
      runId: "run-threat-404",
      agentName: "prospect-qualifier",
      status: "FAILED",
      startTime: "2026-09-13T14:10:00.000Z",
      endTime: "2026-09-13T14:10:00.200Z",
      durationMs: 200,
      totalCostUsd: 0,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      model: "gpt-4o-mini",
      eventsCount: 1,
      toolsUsedCount: 0,
      piiFilteredCount: 1,
      loopAlertTriggered: false,
      clientSecurityAlertsCount: 1,
      clientDataRenderedCount: 0,
      events: [
        {
          type: "CLIENT_SECURITY_ALERT",
          alertType: "SUSPECTED_SECRET_INPUT",
          inputLength: 48,
          matchedPatternSnippet: "sk-ant-api03-ab9...",
          timestamp: "2026-09-13T14:10:00.120Z",
        },
      ],
    };

    this.sessions.set(run1.runId, run1);
    this.sessions.set(run2.runId, run2);
    this.sessions.set(run3.runId, run3);
    this.sessions.set(run4.runId, run4);

    this.approvals.set("appr_01", {
      id: "appr_01",
      runId: "run-prospect-101",
      agentName: "prospect-qualifier",
      stepName: "send-outreach-email",
      actionType: "SEND_OUTREACH_EMAIL",
      payloadSummary: {
        recipientDomain: "acme.com",
        template: "executive_pitch",
        leadScore: 85,
        estimatedDealSize: "$50,000",
      },
      status: "PENDING",
      createdAt: "2026-09-13T13:40:02.000Z",
    });
  }
}

// Global singleton instance for the app
const globalForStore = globalThis as unknown as { telemetryStore: TelemetryStore | undefined };
export const telemetryStore = globalForStore.telemetryStore ?? new TelemetryStore();
if (process.env.NODE_ENV !== "production") {
  globalForStore.telemetryStore = telemetryStore;
}
