"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  BrowserTelemetryExporter,
  BrowserTelemetryExporterConfig,
} from "@/lib/telemetry/browser-exporter";
import {
  ClientSecurityAlertEvent,
  UserFeedbackEvent,
} from "@/lib/types/telemetry";

export type UseAvantGateTelemetryOptions = BrowserTelemetryExporterConfig;

export interface UseAvantGateTelemetryReturn {
  exporter: BrowserTelemetryExporter;
  trackSecurityAlert: (
    alertType: ClientSecurityAlertEvent["alertType"],
    details: { inputLength: number; snippet?: string }
  ) => void;
  trackClientDataRendered: (
    toolId: string,
    renderedItemCount?: number,
    channel?: "SOCKET" | "STREAM" | "HTTP"
  ) => void;
  trackFeedback: (feedback: {
    rating: UserFeedbackEvent["rating"];
    tag?: UserFeedbackEvent["feedbackTag"];
    comment?: string;
  }) => void;
}

export const useAvantGateTelemetry = (
  options: UseAvantGateTelemetryOptions
): UseAvantGateTelemetryReturn => {
  const exporter = useMemo(() => {
    return new BrowserTelemetryExporter({
      publicKey: options.publicKey,
      endpoint: options.endpoint ?? "/api/v1/ingest/events",
      agentName: options.agentName ?? "web-client",
      runId: options.runId,
      batchIntervalMs: options.batchIntervalMs ?? 3000,
      maxBatchSize: options.maxBatchSize ?? 20,
    });
  }, [
    options.publicKey,
    options.endpoint,
    options.agentName,
    options.batchIntervalMs,
    options.maxBatchSize,
  ]);

  const runIdRef = useRef(options.runId);
  useEffect(() => {
    if (options.runId && options.runId !== runIdRef.current) {
      runIdRef.current = options.runId;
      exporter.setRunId(options.runId);
    }
  }, [options.runId, exporter]);

  useEffect(() => {
    return () => {
      exporter.destroy();
    };
  }, [exporter]);

  const trackSecurityAlert = (
    alertType: ClientSecurityAlertEvent["alertType"],
    details: { inputLength: number; snippet?: string }
  ) => {
    exporter.emitEvent({
      type: "CLIENT_SECURITY_ALERT",
      alertType,
      inputLength: details.inputLength,
      matchedPatternSnippet: details.snippet,
      timestamp: new Date().toISOString(),
    });
  };

  const trackClientDataRendered = (
    toolId: string,
    renderedItemCount?: number,
    channel: "SOCKET" | "STREAM" | "HTTP" = "HTTP"
  ) => {
    exporter.emitEvent({
      type: "CLIENT_DATA_RENDERED",
      toolId,
      channel,
      renderedItemCount,
      timestamp: new Date().toISOString(),
    });
  };

  const trackFeedback = (feedback: {
    rating: UserFeedbackEvent["rating"];
    tag?: UserFeedbackEvent["feedbackTag"];
    comment?: string;
  }) => {
    exporter.emitEvent({
      type: "USER_FEEDBACK",
      rating: feedback.rating,
      feedbackTag: feedback.tag,
      userComment: feedback.comment,
      timestamp: new Date().toISOString(),
    });
  };

  return {
    exporter,
    trackSecurityAlert,
    trackClientDataRendered,
    trackFeedback,
  };
};
