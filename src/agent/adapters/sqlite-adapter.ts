import type {
  StepRecord,
  StepStatus,
  StepStorageAdapter,
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
  let result: any = row.result;
  let metadata: any = row.metadata;
  try {
    if (typeof row.result === "string") result = JSON.parse(row.result);
  } catch {}
  try {
    if (typeof row.metadata === "string") metadata = JSON.parse(row.metadata);
  } catch {}

  return {
    workflowId: row.workflow_id,
    stepId: row.step_id,
    status: row.status as StepStatus,
    result,
    error: row.error ?? undefined,
    metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * SQLite storage adapter for local edge execution and serverless durable workflows.
 * Automatically initializes the `avantgate_steps` table.
 */
export class SQLiteStorageAdapter implements StepStorageAdapter {
  private readonly db: SQLiteDatabaseLike;

  constructor(db: SQLiteDatabaseLike) {
    this.db = db;
    this.initTable();
  }

  private initTable(): void {
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

    const resultStr = step.result !== undefined ? JSON.stringify(step.result) : null;
    const metadataStr = step.metadata ? JSON.stringify(step.metadata) : null;

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
      ...(existing ?? {
        workflowId,
        stepId,
        createdAt: now,
      }),
      ...patch,
      status,
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
}
