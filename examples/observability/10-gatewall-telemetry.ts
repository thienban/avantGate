import { HttpTelemetryExporter } from "avantgate/agent";

export const createTelemetryExporterExample = (): HttpTelemetryExporter => {
  return new HttpTelemetryExporter({
    endpoint: "http://localhost:3000/api/v1/ingest/events",
    agentName: "sales-assistant",
    flushIntervalMs: 3000,
    maxBatchSize: 20,
    onError: (error) => {
      console.error("Telemetry ingest failure:", error);
    },
  });
};
