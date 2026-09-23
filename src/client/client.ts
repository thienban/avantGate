import { BrowserTelemetryExporter } from "./browser-exporter";
import type {
  BrowserTelemetryExporterConfig,
  ClientSecurityAlertEvent,
} from "./types";

export interface TrackSecurityAlertDetails {
  inputLength: number;
  snippet?: string;
  matchedPatternSnippet?: string;
}

export interface TrackDataRenderedOptions {
  renderedItemCount?: number;
  channel?: "SOCKET" | "STREAM" | "HTTP";
}

export interface TrackFeedbackOptions {
  rating: "POSITIVE" | "NEGATIVE";
  tag?: "HELPFUL" | "INACCURATE" | "UNSAFE" | "OFF_TOPIC";
  comment?: string;
}

/**
 * Public interface for the universal (framework-agnostic) avantGate telemetry client.
 */
export interface AvantGateClient {
  trackSecurityAlert: (
    alertType: ClientSecurityAlertEvent["alertType"],
    details: TrackSecurityAlertDetails
  ) => void;
  trackClientDataRendered: (
    toolId: string,
    options?: TrackDataRenderedOptions
  ) => void;
  trackFeedback: (feedback: TrackFeedbackOptions) => void;
  updateContext: (context: { runId?: string; agentName?: string }) => void;
  flush: () => Promise<void>;
  destroy: () => void;
  exporter: BrowserTelemetryExporter;
}

/**
 * Creates a universal, framework-agnostic avantGate client instance.
 * Works seamlessly in Vite (Vanilla JS, Vue, Svelte, SolidJS), Next.js, or browser scripts.
 */
export const createAvantGateClient = (
  config: BrowserTelemetryExporterConfig
): AvantGateClient => {
  const exporter = new BrowserTelemetryExporter(config);

  const trackSecurityAlert = (
    alertType: ClientSecurityAlertEvent["alertType"],
    details: TrackSecurityAlertDetails
  ): void => {
    const snippet = details.snippet ?? details.matchedPatternSnippet;
    exporter.emit({
      type: "CLIENT_SECURITY_ALERT",
      alertType,
      inputLength: details.inputLength,
      snippet,
      matchedPatternSnippet: snippet,
      timestamp: new Date().toISOString(),
    });
  };

  const trackClientDataRendered = (
    toolId: string,
    options?: TrackDataRenderedOptions
  ): void => {
    exporter.emit({
      type: "CLIENT_DATA_RENDERED",
      toolId,
      channel: options?.channel,
      renderedItemCount: options?.renderedItemCount,
      timestamp: new Date().toISOString(),
    });
  };

  const trackFeedback = (feedback: TrackFeedbackOptions): void => {
    exporter.emit({
      type: "USER_FEEDBACK",
      rating: feedback.rating,
      feedbackTag: feedback.tag,
      userComment: feedback.comment,
      timestamp: new Date().toISOString(),
    });
  };

  return {
    trackSecurityAlert,
    trackClientDataRendered,
    trackFeedback,
    updateContext: exporter.updateContext,
    flush: exporter.flush,
    destroy: exporter.destroy,
    exporter,
  };
};
