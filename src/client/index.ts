export { BrowserTelemetryExporter } from "./browser-exporter";
export {
  createAvantGateClient,
  type AvantGateClient,
  type TrackSecurityAlertDetails,
  type TrackDataRenderedOptions,
  type TrackFeedbackOptions,
} from "./client";
export { useAvantGateTelemetry } from "./useAvantGateTelemetry";
export type {
  ClientSecurityAlertEvent,
  ClientDataRenderedEvent,
  UserFeedbackEvent,
  ClientTelemetryEvent,
  BrowserTelemetryExporterConfig,
  ClientTelemetryIngestPayload,
} from "./types";
