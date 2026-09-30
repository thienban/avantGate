// Core Transport & Client
export { BrowserTelemetryExporter } from "./browser-exporter";
export {
  createClient,
  type Client,
  type TrackDataRenderedOptions,
  type TrackFeedbackOptions,
  type TrackSecurityAlertDetails,
} from "./client";

export { useTask } from "./useTask";
export { useTelemetry } from "./useTelemetry";

export {
  createTaskRunner,
  type TaskRunner,
  type TaskRunnerOptions,
} from "./task-runner";

export {
  deriveOpaqueTaskId,
  generateRunId,
  createInitialTaskState,
  validateRetryEligibility,
} from "./task-utils";

export type {
  TaskExecutionContext,
  TaskState,
  UseTaskOptions,
  UseTaskReturn,
} from "./task-types";

// Telemetry Event Schemas & Types
export type {
  BrowserTelemetryExporterConfig,
  ClientDataRenderedEvent,
  ClientSecurityAlertEvent,
  ClientTelemetryEvent,
  ClientTelemetryIngestPayload,
  UserFeedbackEvent,
} from "./types";
