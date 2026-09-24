import { RunEvent, TelemetryIngestPayload } from "../types/telemetry";

export interface BrowserTelemetryExporterConfig {
  publicKey: string;
  endpoint?: string;
  agentName?: string;
  runId?: string;
  batchIntervalMs?: number;
  maxBatchSize?: number;
}

export class BrowserTelemetryExporter {
  private publicKey: string;
  private endpoint: string;
  private agentName: string;
  private runId: string;
  private batchIntervalMs: number;
  private maxBatchSize: number;
  private buffer: RunEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private boundVisibilityHandler: (() => void) | null = null;
  private boundUnloadHandler: (() => void) | null = null;

  constructor(config: BrowserTelemetryExporterConfig) {
    this.publicKey = config.publicKey;
    this.endpoint = config.endpoint || "/api/v1/ingest/events";
    this.agentName = config.agentName || "browser-client";
    this.runId = config.runId || `run_browser_${Date.now()}`;
    this.batchIntervalMs = config.batchIntervalMs || 3000;
    this.maxBatchSize = config.maxBatchSize || 20;

    this.startBatchTimer();
    this.setupBrowserLifecycleListeners();
  }

  public setRunId(runId: string): void {
    if (this.buffer.length > 0 && this.runId !== runId) {
      void this.flush();
    }
    this.runId = runId;
  }

  public emitEvent(event: RunEvent): void {
    this.buffer.push(event);
    if (this.buffer.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  public async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const eventsToSend = [...this.buffer];
    this.buffer = [];

    const payload: TelemetryIngestPayload = {
      runId: this.runId,
      agentName: this.agentName,
      timestamp: new Date().toISOString(),
      events: eventsToSend,
    };

    try {
      await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.publicKey}`,
        },
        body: JSON.stringify(payload),
        keepalive: true,
      });
    } catch (error) {
      // Re-queue events if network error occurs, capping at max 100
      this.buffer = [...eventsToSend, ...this.buffer].slice(-100);
      console.warn("[avantGate Browser Exporter] Flush failed, events re-queued:", error);
    }
  }

  private startBatchTimer(): void {
    if (typeof window === "undefined") return;
    this.timer = setInterval(() => {
      if (this.buffer.length > 0) {
        void this.flush();
      }
    }, this.batchIntervalMs);
  }

  private setupBrowserLifecycleListeners(): void {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    this.boundVisibilityHandler = () => {
      if (document.visibilityState === "hidden") {
        void this.flush();
      }
    };
    document.addEventListener("visibilitychange", this.boundVisibilityHandler);

    this.boundUnloadHandler = () => {
      void this.flush();
    };
    window.addEventListener("beforeunload", this.boundUnloadHandler);
  }

  public destroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      if (this.boundVisibilityHandler) {
        document.removeEventListener("visibilitychange", this.boundVisibilityHandler);
      }
      if (this.boundUnloadHandler) {
        window.removeEventListener("beforeunload", this.boundUnloadHandler);
      }
    }
    void this.flush();
  }
}

export const createBrowserTelemetryExporter = (
  config: BrowserTelemetryExporterConfig
): BrowserTelemetryExporter => {
  return new BrowserTelemetryExporter(config);
};
