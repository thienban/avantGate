import fs from "fs";
import path from "path";
import { SessionRun, ApprovalItem } from "../types/telemetry";
import { ModelPricingItem } from "../types/pricing";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "gatewall.db");
const JSON_BACKUP_FILE = path.join(DATA_DIR, "gatewall-store.json");

interface SqliteInstance {
  exec: (sql: string) => void;
  prepare: (sql: string) => {
    run: (...params: unknown[]) => unknown;
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

      CREATE TABLE IF NOT EXISTS model_pricing (
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_usd_per_million REAL NOT NULL,
        completion_usd_per_million REAL NOT NULL,
        cache_hit_usd_per_million REAL,
        is_active INTEGER DEFAULT 1,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider, model)
      );

      CREATE INDEX IF NOT EXISTS idx_model_pricing_lookup 
      ON model_pricing(provider, model, is_active);
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
  pricing?: ModelPricingItem[];
}

const readJsonFallback = (): JsonStoragePayload => {
  ensureDataDir();
  if (!fs.existsSync(JSON_BACKUP_FILE)) {
    return { sessions: [], approvals: [], pricing: [] };
  }
  try {
    const raw = fs.readFileSync(JSON_BACKUP_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      sessions: parsed.sessions || [],
      approvals: parsed.approvals || [],
      pricing: parsed.pricing || [],
    };
  } catch {
    return { sessions: [], approvals: [], pricing: [] };
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

// --- Model Pricing Storage API ---

export const loadPersistedPricing = (): ModelPricingItem[] => {
  const db = initSqlite();
  if (!db || useJsonFallback) {
    return readJsonFallback().pricing || [];
  }

  try {
    const stmt = db.prepare(`
      SELECT provider, model, prompt_usd_per_million, completion_usd_per_million, 
             cache_hit_usd_per_million, is_active, updated_at
      FROM model_pricing
      ORDER BY provider ASC, model ASC
    `);
    const rows = stmt.all() as {
      provider: string;
      model: string;
      prompt_usd_per_million: number;
      completion_usd_per_million: number;
      cache_hit_usd_per_million: number | null;
      is_active: number;
      updated_at: string;
    }[];

    return rows.map((r) => ({
      provider: r.provider,
      model: r.model,
      promptUSDPerMillion: Number(r.prompt_usd_per_million),
      completionUSDPerMillion: Number(r.completion_usd_per_million),
      cacheHitUSDPerMillion: r.cache_hit_usd_per_million != null ? Number(r.cache_hit_usd_per_million) : undefined,
      isActive: Boolean(r.is_active),
      updatedAt: r.updated_at,
    }));
  } catch (err) {
    console.error("[gateWall Storage] Failed to load model pricing from SQLite:", err);
    return readJsonFallback().pricing || [];
  }
};

export const persistPrice = (item: ModelPricingItem): void => {
  const db = initSqlite();
  if (!db || useJsonFallback) {
    const data = readJsonFallback();
    if (!data.pricing) data.pricing = [];
    const index = data.pricing.findIndex(
      (p) => p.provider.toLowerCase() === item.provider.toLowerCase() && p.model.toLowerCase() === item.model.toLowerCase()
    );
    if (index >= 0) {
      data.pricing[index] = item;
    } else {
      data.pricing.unshift(item);
    }
    writeJsonFallback(data);
    return;
  }

  try {
    const stmt = db.prepare(`
      INSERT INTO model_pricing (
        provider, model, prompt_usd_per_million, completion_usd_per_million, 
        cache_hit_usd_per_million, is_active, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, model) DO UPDATE SET
        prompt_usd_per_million = excluded.prompt_usd_per_million,
        completion_usd_per_million = excluded.completion_usd_per_million,
        cache_hit_usd_per_million = excluded.cache_hit_usd_per_million,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at;
    `);

    stmt.run(
      item.provider.trim().toLowerCase(),
      item.model.trim().toLowerCase(),
      item.promptUSDPerMillion,
      item.completionUSDPerMillion,
      item.cacheHitUSDPerMillion ?? null,
      item.isActive ? 1 : 0,
      item.updatedAt || new Date().toISOString()
    );
  } catch (err) {
    console.error("[gateWall Storage] Failed to persist model price to SQLite:", err);
  }
};

export const deletePersistedPrice = (provider: string, model: string): boolean => {
  const normProvider = provider.trim().toLowerCase();
  const normModel = model.trim().toLowerCase();

  const db = initSqlite();
  if (!db || useJsonFallback) {
    const data = readJsonFallback();
    if (!data.pricing) return false;
    const initialLen = data.pricing.length;
    data.pricing = data.pricing.filter(
      (p) => !(p.provider.toLowerCase() === normProvider && p.model.toLowerCase() === normModel)
    );
    writeJsonFallback(data);
    return data.pricing.length < initialLen;
  }

  try {
    const stmt = db.prepare("DELETE FROM model_pricing WHERE provider = ? AND model = ?");
    const result = stmt.run(normProvider, normModel) as { changes?: number };
    return Boolean(result && typeof result.changes === "number" && result.changes > 0);
  } catch (err) {
    console.error("[gateWall Storage] Failed to delete model price from SQLite:", err);
    return false;
  }
};

export const seedPersistedPricing = (force: boolean = false): number => {
  const defaults: Array<Omit<ModelPricingItem, "updatedAt">> = [
    { provider: "deepseek", model: "deepseek-chat", promptUSDPerMillion: 0.14, completionUSDPerMillion: 0.28, cacheHitUSDPerMillion: 0.014, isActive: true },
    { provider: "deepseek", model: "deepseek-reasoner", promptUSDPerMillion: 0.55, completionUSDPerMillion: 2.19, cacheHitUSDPerMillion: 0.14, isActive: true },
    { provider: "mistral", model: "mistral-small-latest", promptUSDPerMillion: 0.20, completionUSDPerMillion: 0.60, isActive: true },
    { provider: "mistral", model: "mistral-large-latest", promptUSDPerMillion: 2.00, completionUSDPerMillion: 6.00, isActive: true },
    { provider: "openai", model: "gpt-4o-mini", promptUSDPerMillion: 0.15, completionUSDPerMillion: 0.60, isActive: true },
    { provider: "openai", model: "gpt-4o", promptUSDPerMillion: 2.50, completionUSDPerMillion: 10.00, isActive: true },
    { provider: "openrouter", model: "anthropic/claude-3.5-sonnet", promptUSDPerMillion: 3.00, completionUSDPerMillion: 15.00, isActive: true },
    { provider: "ollama", model: "all-models", promptUSDPerMillion: 0.0, completionUSDPerMillion: 0.0, isActive: true },
  ];

  let count = 0;
  const existing = loadPersistedPricing();
  if (existing.length > 0 && !force) {
    return 0;
  }

  for (const item of defaults) {
    persistPrice({
      ...item,
      updatedAt: new Date().toISOString(),
    });
    count++;
  }

  return count;
};
