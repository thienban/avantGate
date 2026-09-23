import { useRef, useEffect, useCallback, useMemo } from "react";
import {
  createAvantGateClient,
  type AvantGateClient,
  type TrackSecurityAlertDetails,
  type TrackDataRenderedOptions,
  type TrackFeedbackOptions,
} from "./client";
import type {
  BrowserTelemetryExporterConfig,
  ClientSecurityAlertEvent,
} from "./types";

export type {
  TrackSecurityAlertDetails,
  TrackDataRenderedOptions,
  TrackFeedbackOptions,
};

/**
 * Lightweight React Hook for front-end telemetry and client-side security event tracking.
 * Encapsulates lifecycle management, useRef persistence, useCallback and useMemo optimization.
 */
export const useAvantGateTelemetry = (config: BrowserTelemetryExporterConfig) => {
  const clientRef = useRef<AvantGateClient | null>(null);

  if (!clientRef.current) {
    clientRef.current = createAvantGateClient(config);
  }

  useEffect(() => {
    clientRef.current?.updateContext({
      runId: config.runId,
      agentName: config.agentName,
    });
  }, [config.runId, config.agentName]);

  useEffect(() => {
    return () => {
      clientRef.current?.destroy();
      clientRef.current = null;
    };
  }, []);

  const trackSecurityAlert = useCallback(
    (
      alertType: ClientSecurityAlertEvent["alertType"],
      details: TrackSecurityAlertDetails
    ): void => {
      clientRef.current?.trackSecurityAlert(alertType, details);
    },
    []
  );

  const trackClientDataRendered = useCallback(
    (
      toolId: string,
      options?: TrackDataRenderedOptions
    ): void => {
      clientRef.current?.trackClientDataRendered(toolId, options);
    },
    []
  );

  const trackFeedback = useCallback(
    (feedback: TrackFeedbackOptions): void => {
      clientRef.current?.trackFeedback(feedback);
    },
    []
  );

  return useMemo(
    () => ({
      trackSecurityAlert,
      trackClientDataRendered,
      trackFeedback,
      exporter: clientRef.current?.exporter,
    }),
    [trackSecurityAlert, trackClientDataRendered, trackFeedback]
  );
};
