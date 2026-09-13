/**
 * Supported telemetry event types for the avantGate observability platform.
 */
export type TelemetryEventType =
  | "STEP_START"
  | "STEP_COMPLETED"
  | "STEP_FAILED"
  | "STEP_APPROVAL_REQUEST"
  | "TOOL_EXECUTION";

/**
 * Base properties shared across all telemetry events.
 */
export interface BaseTelemetryEvent {
  type: TelemetryEventType;
  timestamp: string;
}

export interface StepStartEvent extends BaseTelemetryEvent {
  type: "STEP_START";
  stepName: string;
  metadata?: Record<string, unknown>;
}

export interface StepCompletedEvent extends BaseTelemetryEvent {
  type: "STEP_COMPLETED";
  stepName: string;
  durationMs?: number;
  piiDetectedCount?: number;
  resultSummary?: unknown;
  metadata?: Record<string, unknown>;
}

export interface StepFailedEvent extends BaseTelemetryEvent {
  type: "STEP_FAILED";
  stepName: string;
  durationMs?: number;
  error: string;
}

export interface StepApprovalRequestEvent extends BaseTelemetryEvent {
  type: "STEP_APPROVAL_REQUEST";
  stepName: string;
  actionType?: string;
  payloadSummary?: unknown;
}

export interface ToolExecutionTelemetryEvent extends BaseTelemetryEvent {
  type: "TOOL_EXECUTION";
  toolId: string;
  toolName: string;
  aliasUsed?: string;
  durationMs: number;
  success: boolean;
  parentToolId?: string;
  depth?: number;
  llmSummary?: unknown;
  piiFilteredCount?: number;
  tokenCount?: number;
  tokens?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  costUsd?: number;
  cached?: boolean;
  error?: string;
}

export type TelemetryEvent =
  | StepStartEvent
  | StepCompletedEvent
  | StepFailedEvent
  | StepApprovalRequestEvent
  | ToolExecutionTelemetryEvent;

/**
 * Consolidates token usage and FinOps metrics for a batch or run.
 */
export interface TelemetryUsageSummary {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  costUsd?: number;
}

/**
 * Payload schema ingested by POST /api/v1/ingest/events according to DESIGN-005 §5.1.
 */
export interface TelemetryIngestPayload {
  runId: string;
  agentName?: string;
  timestamp: string;
  events: TelemetryEvent[];
  usage?: TelemetryUsageSummary;
}

/**
 * Configuration options for the HTTP Telemetry Exporter.
 */
export interface HttpTelemetryExporterOptions {
  apiKey: string;
  endpoint?: string;
  agentName?: string;
  batchIntervalMs?: number;
  maxBatchSize?: number;
  maxQueueSize?: number;
  fetchFn?: typeof fetch;
  onError?: (error: Error) => void;
}
