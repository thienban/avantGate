import type {
  StepRecord,
  StepStatus,
  StepStorageAdapter,
  ToolExecutionRecord,
} from "../types";

export interface SQLiteStatementLike {
  get(...params: any[]): any;
  all(...params: any[]): any[];
  run(...params: any[]): any;
}

export interface SQLiteDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): SQLiteStatementLike;
}

function parseSqliteRow<T>(row: any): StepRecord<T> {
  let result: T | undefined = undefined;
  let metadata: Record<string, unknown> | undefined = undefined;

  try {
    if (row.result) {
      result = JSON.parse(row.result);
    }
  } catch {}

  try {
    if (row.metadata) {
      metadata = JSON.parse(row.metadata);
    }
  } catch {}

  return {
    workflowId: row.workflow_id,
    stepId: row.step_id,
    runId: (metadata?.runId as string) ?? row.workflow_id,
    status: row.status as StepStatus,
    result,
    error: row.error ?? undefined,
    piiDetectedCount: metadata?.piiDetectedCount as number | undefined,
    tokens: metadata?.tokens as any,
    costUsd: metadata?.costUsd as number | undefined,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseExecutionRow(row: any): ToolExecutionRecord {
  let inputArgs: any = row.input_args;
  let outputSummary: any = row.output_summary;
  try {
    if (typeof row.input_args === "string") inputArgs = JSON.parse(row.input_args);
  } catch {}
  try {
    if (typeof row.output_summary === "string") outputSummary = JSON.parse(row.output_summary);
  } catch {}

  return {
    executionId: row.execution_id,
    workflowId: row.workflow_id ?? undefined,
    stepId: row.step_id ?? undefined,
    runId: row.workflow_id ?? undefined,
    toolId: row.tool_id,
    parentToolId: row.parent_tool_id ?? undefined,
    aliasUsed: row.alias_used ?? undefined,
    depth: Number(row.depth),
    inputArgs,
    outputSummary,
    durationMs: Number(row.duration_ms),
    status: row.status as "SUCCESS" | "FAILED",
    error: row.error ?? undefined,
    piiFilteredCount:
      row.pii_filtered_count !== null && row.pii_filtered_count !== undefined
        ? Number(row.pii_filtered_count)
        : undefined,
    costUsd:
      row.cost_usd !== null && row.cost_usd !== undefined
        ? Number(row.cost_usd)
        : undefined,
    createdAt: row.created_at,
  };
}

/**
 * SQLite storage adapter for local edge execution and serverless durable workflows.
 * Automatically initializes tables for steps, tool executions, cache and blackboard state.
 */
export class SQLiteStorageAdapter implements StepStorageAdapter {
  private readonly db: SQLiteDatabaseLike;

  constructor(db: SQLiteDatabaseLike) {
    this.db = db;
    this.initTables();
  }

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS avantgate_steps (
        workflow_id TEXT NOT NULL,
        step_id TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (workflow_id, step_id)
      );

      CREATE TABLE IF NOT EXISTS avantgate_tool_executions (
        execution_id TEXT PRIMARY KEY,
        workflow_id TEXT,
        step_id TEXT,
        tool_id TEXT NOT NULL,
        parent_tool_id TEXT,
        alias_used TEXT,
        depth INTEGER NOT NULL,
        input_args TEXT,
        output_summary TEXT,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        pii_filtered_count INTEGER,
        cost_usd REAL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS avantgate_tool_cache (
        cache_key TEXT PRIMARY KEY,
        result TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS avantgate_shared_state (
        state_key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at INTEGER
      );
    `);
  }

  public async getStep<T = unknown>(
    workflowId: string,
    stepId: string
  ): Promise<StepRecord<T> | null> {
    const stmt = this.db.prepare(
      "SELECT * FROM avantgate_steps WHERE workflow_id = ? AND step_id = ?"
    );
    const row = stmt.get(workflowId, stepId);
    if (!row) {
      return null;
    }
    return parseSqliteRow<T>(row);
  }

  public async saveStep<T = unknown>(step: StepRecord<T>): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO avantgate_steps (
        workflow_id, step_id, status, result, error, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workflow_id, step_id) DO UPDATE SET
        status = excluded.status,
        result = excluded.result,
        error = excluded.error,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at;
    `);

    const mergedMetadata = {
      ...(step.metadata ?? {}),
      ...(step.runId ? { runId: step.runId } : {}),
      ...(step.piiDetectedCount !== undefined ? { piiDetectedCount: step.piiDetectedCount } : {}),
      ...(step.tokens ? { tokens: step.tokens } : {}),
      ...(step.costUsd !== undefined ? { costUsd: step.costUsd } : {}),
    };

    const resultStr = step.result !== undefined ? JSON.stringify(step.result) : null;
    const metadataStr = Object.keys(mergedMetadata).length > 0 ? JSON.stringify(mergedMetadata) : null;

    stmt.run(
      step.workflowId,
      step.stepId,
      step.status,
      resultStr,
      step.error ?? null,
      metadataStr,
      step.createdAt,
      step.updatedAt
    );
  }

  public async updateStepStatus<T = unknown>(
    workflowId: string,
    stepId: string,
    status: StepStatus,
    patch?: Partial<StepRecord<T>>
  ): Promise<void> {
    const existing = await this.getStep<T>(workflowId, stepId);
    const now = new Date().toISOString();

    const updated: StepRecord<T> = {
      workflowId,
      stepId,
      status,
      result: patch?.result !== undefined ? patch.result : existing?.result,
      error: patch?.error !== undefined ? patch.error : existing?.error,
      metadata: patch?.metadata !== undefined ? patch.metadata : existing?.metadata,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.saveStep(updated);
  }

  public async listSteps(workflowId: string): Promise<StepRecord[]> {
    const stmt = this.db.prepare(
      "SELECT * FROM avantgate_steps WHERE workflow_id = ? ORDER BY created_at ASC"
    );
    const rows = stmt.all(workflowId);
    return rows.map(parseSqliteRow);
  }

  public async saveToolExecution(record: ToolExecutionRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO avantgate_tool_executions (
        execution_id, workflow_id, step_id, tool_id, parent_tool_id, alias_used,
        depth, input_args, output_summary, duration_ms, status, error,
        pii_filtered_count, cost_usd, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      record.executionId,
      record.workflowId ?? null,
      record.stepId ?? null,
      record.toolId,
      record.parentToolId ?? null,
      record.aliasUsed ?? null,
      record.depth,
      record.inputArgs !== undefined ? JSON.stringify(record.inputArgs) : null,
      record.outputSummary !== undefined ? JSON.stringify(record.outputSummary) : null,
      record.durationMs,
      record.status,
      record.error ?? null,
      record.piiFilteredCount ?? null,
      record.costUsd ?? null,
      record.createdAt
    );
  }

  public async listToolExecutions(
    workflowId?: string,
    stepId?: string
  ): Promise<ToolExecutionRecord[]> {
    let query = "SELECT * FROM avantgate_tool_executions";
    const params: any[] = [];

    if (workflowId && stepId) {
      query += " WHERE workflow_id = ? AND step_id = ?";
      params.push(workflowId, stepId);
    } else if (workflowId) {
      query += " WHERE workflow_id = ?";
      params.push(workflowId);
    }

    query += " ORDER BY created_at ASC";
    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params);
    return rows.map(parseExecutionRow);
  }

  public async getCachedToolResult<T = unknown>(cacheKey: string): Promise<T | null> {
    const stmt = this.db.prepare(
      "SELECT result, expires_at FROM avantgate_tool_cache WHERE cache_key = ?"
    );
    const row = stmt.get(cacheKey);
    if (!row) {
      return null;
    }
    if (Date.now() > Number(row.expires_at)) {
      this.db.prepare("DELETE FROM avantgate_tool_cache WHERE cache_key = ?").run(cacheKey);
      return null;
    }
    try {
      return JSON.parse(row.result) as T;
    } catch {
      return null;
    }
  }

  public async setCachedToolResult<T = unknown>(
    cacheKey: string,
    result: T,
    ttlSeconds: number
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO avantgate_tool_cache (cache_key, result, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        result = excluded.result,
        expires_at = excluded.expires_at;
    `);
    const expiresAt = Date.now() + ttlSeconds * 1000;
    stmt.run(cacheKey, JSON.stringify(result), expiresAt);
  }

  public async getStateValue<T = unknown>(key: string): Promise<T | null> {
    const stmt = this.db.prepare(
      "SELECT value, expires_at FROM avantgate_shared_state WHERE state_key = ?"
    );
    const row = stmt.get(key);
    if (!row) {
      return null;
    }
    if (row.expires_at && Date.now() > Number(row.expires_at)) {
      this.db.prepare("DELETE FROM avantgate_shared_state WHERE state_key = ?").run(key);
      return null;
    }
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  public async setStateValue<T = unknown>(
    key: string,
    value: T,
    ttlSeconds?: number
  ): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO avantgate_shared_state (state_key, value, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(state_key) DO UPDATE SET
        value = excluded.value,
        expires_at = excluded.expires_at;
    `);
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    stmt.run(key, JSON.stringify(value), expiresAt);
  }

  public async deleteStateValue(key: string): Promise<void> {
    this.db.prepare("DELETE FROM avantgate_shared_state WHERE state_key = ?").run(key);
  }
}
