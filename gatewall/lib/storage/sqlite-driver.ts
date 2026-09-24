import fs from "fs";
import path from "path";
import { SessionRun, ApprovalItem } from "../types/telemetry";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "gatewall.db");
const JSON_BACKUP_FILE = path.join(DATA_DIR, "gatewall-store.json");

interface SqliteInstance {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => void;
    all: (...params: unknown[]) => unknown[];
    get: (...params: unknown[]) => unknown;
  };
}

let dbInstance: SqliteInstance | null = null;
let useJsonFallback = false;

const ensureDataDir = (): void => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

const initSqlite = (): SqliteInstance | null => {
  if (dbInstance) return dbInstance;
  ensureDataDir();

  try {
    // Attempt using native node:sqlite DatabaseSync (Node 22+)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(DB_FILE);

    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        run_id TEXT PRIMARY KEY,
        agent_name TEXT NOT NULL,
        status TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT,
        duration_ms INTEGER DEFAULT 0,
        total_cost_usd REAL DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        prompt_tokens INTEGER DEFAULT 0,
        completion_tokens INTEGER DEFAULT 0,
        model TEXT DEFAULT 'gpt-4o-mini',
        events_count INTEGER DEFAULT 0,
        tools_used_count INTEGER DEFAULT 0,
        pii_filtered_count INTEGER DEFAULT 0,
        loop_alert_triggered INTEGER DEFAULT 0,
        client_security_alerts_count INTEGER DEFAULT 0,
        client_data_rendered_count INTEGER DEFAULT 0,
        payload_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        step_name TEXT NOT NULL,
        action_type TEXT NOT NULL,
        payload_summary_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        decided_by TEXT,
        reason TEXT
      );
    `);

    dbInstance = db;
    return db;
  } catch (error) {
    console.warn("[gateWall Storage] Native SQLite unavailable, falling back to persistent JSON storage:", error);
    useJsonFallback = true;
    return null;
  }
};

// --- JSON Fallback Handlers ---
interface JsonStoragePayload {
  sessions: SessionRun[];
  approvals: ApprovalItem[];
}

const readJsonFallback = (): JsonStoragePayload => {
  ensureDataDir();
  if (!fs.existsSync(JSON_BACKUP_FILE)) {
    return { sessions: [], approvals: [] };
  }
  try {
    const raw = fs.readFileSync(JSON_BACKUP_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { sessions: [], approvals: [] };
  }
};

const writeJsonFallback = (data: JsonStoragePayload): void => {
  ensureDataDir();
  try {
    fs.writeFileSync(JSON_BACKUP_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("[gateWall Storage] Error writing JSON fallback:", err);
  }
};

// --- Public Storage API ---

export const loadPersistedSessions = (): SessionRun[] => {
  const db = initSqlite();
  if (!db || useJsonFallback) {
    return readJsonFallback().sessions;
  }

  try {
    const stmt = db.prepare("SELECT payload_json FROM sessions ORDER BY start_time DESC");
    const rows = stmt.all() as { payload_json: string }[];
    return rows.map((r) => JSON.parse(r.payload_json));
  } catch (err) {
    console.error("[gateWall Storage] Failed to load sessions from SQLite:", err);
    return readJsonFallback().sessions;
  }
};

export const persistSession = (session: SessionRun): void => {
  const db = initSqlite();
  if (!db || useJsonFallback) {
    const data = readJsonFallback();
    const index = data.sessions.findIndex((s) => s.runId === session.runId);
    if (index >= 0) {
      data.sessions[index] = session;
    } else {
      data.sessions.unshift(session);
    }
    writeJsonFallback(data);
    return;
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO sessions (
        run_id, agent_name, status, start_time, end_time, duration_ms,
        total_cost_usd, total_tokens, prompt_tokens, completion_tokens,
        model, events_count, tools_used_count, pii_filtered_count,
        loop_alert_triggered, client_security_alerts_count, client_data_rendered_count,
        payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        agent_name = excluded.agent_name,
        status = excluded.status,
        end_time = excluded.end_time,
        duration_ms = excluded.duration_ms,
        total_cost_usd = excluded.total_cost_usd,
        total_tokens = excluded.total_tokens,
        prompt_tokens = excluded.prompt_tokens,
        completion_tokens = excluded.completion_tokens,
        model = excluded.model,
        events_count = excluded.events_count,
        tools_used_count = excluded.tools_used_count,
        pii_filtered_count = excluded.pii_filtered_count,
        loop_alert_triggered = excluded.loop_alert_triggered,
        client_security_alerts_count = excluded.client_security_alerts_count,
        client_data_rendered_count = excluded.client_data_rendered_count,
        payload_json = excluded.payload_json;
    `);

    stmt.run(
      session.runId,
      session.agentName,
      session.status,
      session.startTime,
      session.endTime ?? null,
      session.durationMs,
      session.totalCostUsd,
      session.totalTokens,
      session.promptTokens,
      session.completionTokens,
      session.model,
      session.eventsCount,
      session.toolsUsedCount,
      session.piiFilteredCount,
      session.loopAlertTriggered ? 1 : 0,
      session.clientSecurityAlertsCount ?? 0,
      session.clientDataRenderedCount ?? 0,
      JSON.stringify(session)
    );
  } catch (err) {
    console.error("[gateWall Storage] Failed to persist session to SQLite:", err);
  }
};

export const loadPersistedApprovals = (): ApprovalItem[] => {
  const db = initSqlite();
  if (!db || useJsonFallback) {
    return readJsonFallback().approvals;
  }

  try {
    const stmt = db.prepare("SELECT * FROM approvals ORDER BY created_at DESC");
    const rows = stmt.all() as {
      id: string;
      run_id: string;
      agent_name: string;
      step_name: string;
      action_type: string;
      payload_summary_json: string;
      status: ApprovalItem["status"];
      created_at: string;
      decided_at?: string;
      decided_by?: string;
      reason?: string;
    }[];

    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      agentName: r.agent_name,
      stepName: r.step_name,
      actionType: r.action_type,
      payloadSummary: JSON.parse(r.payload_summary_json || "{}"),
      status: r.status,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
      decidedBy: r.decided_by,
      reason: r.reason,
    }));
  } catch (err) {
    console.error("[gateWall Storage] Failed to load approvals from SQLite:", err);
    return readJsonFallback().approvals;
  }
};

export const persistApproval = (approval: ApprovalItem): void => {
  const db = initSqlite();
  if (!db || useJsonFallback) {
    const data = readJsonFallback();
    const index = data.approvals.findIndex((a) => a.id === approval.id);
    if (index >= 0) {
      data.approvals[index] = approval;
    } else {
      data.approvals.unshift(approval);
    }
    writeJsonFallback(data);
    return;
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO approvals (
        id, run_id, agent_name, step_name, action_type,
        payload_summary_json, status, created_at, decided_at, decided_by, reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        decided_at = excluded.decided_at,
        decided_by = excluded.decided_by,
        reason = excluded.reason;
    `);

    stmt.run(
      approval.id,
      approval.runId,
      approval.agentName,
      approval.stepName,
      approval.actionType,
      JSON.stringify(approval.payloadSummary || {}),
      approval.status,
      approval.createdAt,
      approval.decidedAt ?? null,
      approval.decidedBy ?? null,
      approval.reason ?? null
    );
  } catch (err) {
    console.error("[gateWall Storage] Failed to persist approval to SQLite:", err);
  }
};
