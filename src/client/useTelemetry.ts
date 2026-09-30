import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  createClient,
  type Client,
  type TrackDataRenderedOptions,
  type TrackFeedbackOptions,
  type TrackSecurityAlertDetails,
} from "./client";
import type {
  BrowserTelemetryExporterConfig,
  ClientSecurityAlertEvent,
} from "./types";

export type {
  TrackDataRenderedOptions,
  TrackFeedbackOptions,
  TrackSecurityAlertDetails,
};

export const useTelemetry = (config: BrowserTelemetryExporterConfig) => {
  const clientRef = useRef<Client | null>(null);

  if (!clientRef.current) {
    clientRef.current = createClient(config);
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
