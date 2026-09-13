import type {
  StepRecord,
  StepStatus,
  StepStorageAdapter,
  ToolExecutionRecord,
} from "../types";
import { MemoryStorageAdapter } from "./memory-adapter";
import type { HttpTelemetryExporter } from "../telemetry/http-exporter";
import type {
  StepApprovalRequestEvent,
  StepCompletedEvent,
  StepFailedEvent,
  StepStartEvent,
  TelemetryEvent,
  ToolExecutionTelemetryEvent,
} from "../telemetry/types";

export interface PlatformStorageAdapterConfig {
  exporter: HttpTelemetryExporter;
  primaryStorage?: StepStorageAdapter;
}

function mapStepToEvent(record: StepRecord): TelemetryEvent | null {
  const now = record.updatedAt || record.createdAt || new Date().toISOString();

  if (record.status === "RUNNING") {
    const startEvent: StepStartEvent = {
      type: "STEP_START",
      timestamp: now,
      stepName: record.stepId,
      metadata: record.metadata,
    };
    return startEvent;
  }

  if (record.status === "COMPLETED") {
    const completedEvent: StepCompletedEvent = {
      type: "STEP_COMPLETED",
      timestamp: now,
      stepName: record.stepId,
      piiDetectedCount: record.piiDetectedCount,
      resultSummary: record.result,
      metadata: record.metadata,
    };
    return completedEvent;
  }

  if (record.status === "FAILED") {
    const failedEvent: StepFailedEvent = {
      type: "STEP_FAILED",
      timestamp: now,
      stepName: record.stepId,
      error: record.error ?? "Step execution failed",
    };
    return failedEvent;
  }

  if (record.status === "WAITING_APPROVAL") {
    const approvalEvent: StepApprovalRequestEvent = {
      type: "STEP_APPROVAL_REQUEST",
      timestamp: now,
      stepName: record.stepId,
      actionType: (record.metadata?.actionType as string) ?? "MANUAL_APPROVAL",
      payloadSummary: record.result ?? record.metadata,
    };
    return approvalEvent;
  }

  return null;
}

function mapToolExecutionToEvent(
  record: ToolExecutionRecord
): ToolExecutionTelemetryEvent {
  return {
    type: "TOOL_EXECUTION",
    timestamp: record.createdAt,
    toolId: record.toolId,
    toolName: record.toolId,
    aliasUsed: record.aliasUsed,
    durationMs: record.durationMs,
    success: record.status === "SUCCESS",
    parentToolId: record.parentToolId,
    depth: record.depth,
    llmSummary: record.outputSummary,
    piiFilteredCount: record.piiFilteredCount,
    tokens: record.tokens,
    costUsd: record.costUsd,
    cached: record.cached,
    error: record.error,
  };
}

/**
 * Hexagonal Hybrid Storage Adapter: persists steps and tool executions locally
 * while mirroring telemetry events asynchronously to avantGate Cloud.
 */
export class PlatformStorageAdapter implements StepStorageAdapter {
  private readonly exporter: HttpTelemetryExporter;
  private readonly primary: StepStorageAdapter;

  constructor(config: PlatformStorageAdapterConfig) {
    this.exporter = config.exporter;
    this.primary = config.primaryStorage ?? new MemoryStorageAdapter();
  }

  public async getStep<T = unknown>(
    workflowId: string,
    stepId: string
  ): Promise<StepRecord<T> | null> {
    return this.primary.getStep<T>(workflowId, stepId);
  }

  public async saveStep<T = unknown>(record: StepRecord<T>): Promise<void> {
    await this.primary.saveStep(record);

    const event = mapStepToEvent(record);
    if (!event) return;

    const runId = record.runId ?? record.workflowId;
    this.exporter.enqueue(runId, event, record.tokens ? { ...record.tokens, costUsd: record.costUsd } : undefined);
  }

  public async updateStepStatus(
    workflowId: string,
    stepId: string,
    status: StepStatus,
    updates?: { result?: unknown; error?: string; metadata?: Record<string, unknown> }
  ): Promise<void> {
    await this.primary.updateStepStatus(workflowId, stepId, status, updates);
    const existing = await this.primary.getStep(workflowId, stepId);
    if (!existing) return;

    const event = mapStepToEvent(existing);
    if (!event) return;

    const runId = existing.runId ?? workflowId;
    this.exporter.enqueue(runId, event);
  }

  public async listSteps(workflowId: string): Promise<StepRecord[]> {
    return this.primary.listSteps(workflowId);
  }

  public async saveToolExecution(record: ToolExecutionRecord): Promise<void> {
    if (this.primary.saveToolExecution) {
      await this.primary.saveToolExecution(record);
    }

    const event = mapToolExecutionToEvent(record);
    const runId = record.runId ?? record.workflowId ?? "default-run";
    this.exporter.enqueue(runId, event, record.tokens ? { ...record.tokens, costUsd: record.costUsd } : undefined);
  }

  public async listToolExecutions(
    workflowId?: string,
    stepId?: string
  ): Promise<ToolExecutionRecord[]> {
    if (this.primary.listToolExecutions) {
      return this.primary.listToolExecutions(workflowId, stepId);
    }
    return [];
  }

  public async getCachedToolResult<T = unknown>(cacheKey: string): Promise<T | null> {
    if (this.primary.getCachedToolResult) {
      return this.primary.getCachedToolResult<T>(cacheKey);
    }
    return null;
  }

  public async setCachedToolResult<T = unknown>(
    cacheKey: string,
    result: T,
    ttlSeconds: number
  ): Promise<void> {
    if (this.primary.setCachedToolResult) {
      await this.primary.setCachedToolResult(cacheKey, result, ttlSeconds);
    }
  }

  public async getStateValue<T = unknown>(key: string): Promise<T | null> {
    if (this.primary.getStateValue) {
      return this.primary.getStateValue<T>(key);
    }
    return null;
  }

  public async setStateValue<T = unknown>(
    key: string,
    value: T,
    ttlSeconds?: number
  ): Promise<void> {
    if (this.primary.setStateValue) {
      await this.primary.setStateValue(key, value, ttlSeconds);
    }
  }

  public async deleteStateValue(key: string): Promise<void> {
    if (this.primary.deleteStateValue) {
      await this.primary.deleteStateValue(key);
    }
  }

  public async clearStateValues(): Promise<void> {
    if (this.primary.clearStateValues) {
      await this.primary.clearStateValues();
    }
  }
}
