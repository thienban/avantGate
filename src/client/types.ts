/**
 * Client Security Alert Event emitted when a local pre-flight guardrail detects an anomaly
 * (prompt injection attempt, hardcoded API key, unredacted PII) before network egress.
 */
export interface ClientSecurityAlertEvent {
  type: "CLIENT_SECURITY_ALERT";
  alertType: "POTENTIAL_PROMPT_INJECTION" | "SUSPECTED_SECRET_INPUT" | "SUSPECTED_PII_INPUT";
  inputLength: number;
  snippet?: string;
  matchedPatternSnippet?: string;
  timestamp: string;
}

/**
 * Client Data Rendered Event emitted when tool output or stream chunks are rendered in UI.
 */
export interface ClientDataRenderedEvent {
  type: "CLIENT_DATA_RENDERED";
  toolId: string;
  channel?: "SOCKET" | "STREAM" | "HTTP";
  renderedItemCount?: number;
  timestamp: string;
}

/**
 * User Feedback Event emitted when a user rates or comments on an agent response.
 */
export interface UserFeedbackEvent {
  type: "USER_FEEDBACK";
  rating: "POSITIVE" | "NEGATIVE";
  feedbackTag?: "HELPFUL" | "INACCURATE" | "UNSAFE" | "OFF_TOPIC";
  userComment?: string;
  timestamp: string;
}

/**
 * Union of all supported front-end client telemetry events.
 */
export type ClientTelemetryEvent =
  | ClientSecurityAlertEvent
  | ClientDataRenderedEvent
  | UserFeedbackEvent;

/**
 * Configuration options for BrowserTelemetryExporter.
 */
export interface BrowserTelemetryExporterConfig {
  publicKey: string;
  endpoint?: string;
  agentName?: string;
  runId?: string;
  batchIntervalMs?: number;
  maxBatchSize?: number;
  fetchFn?: typeof fetch;
  onError?: (error: Error) => void;
}

/**
 * Ingest payload format expected by POST /api/v1/ingest/events according to DESIGN-019.
 */
export interface ClientTelemetryIngestPayload {
  runId?: string;
  agentName?: string;
  timestamp: string;
  events: ClientTelemetryEvent[];
}
