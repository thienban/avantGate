import type {
  BrowserTelemetryExporterConfig,
  ClientTelemetryEvent,
  ClientTelemetryIngestPayload,
} from "./types";

const DEFAULT_ENDPOINT = "http://localhost:3000/api/v1/ingest/events";
const DEFAULT_INTERVAL_MS = 3000;
const DEFAULT_MAX_BATCH_SIZE = 20;

export class BrowserTelemetryExporter {
  private readonly publicKey: string;
  private readonly endpoint: string;
  private agentName?: string;
  private runId?: string;
  private readonly batchIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly fetchFn?: typeof fetch;
  private readonly onError?: (error: Error) => void;

  private buffer: ClientTelemetryEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;
  private isDestroyed = false;

  private readonly handleVisibilityChange = (): void => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      void this.flush();
    }
  };

  private readonly handleBeforeUnload = (): void => {
    void this.flush();
  };

  constructor(config: BrowserTelemetryExporterConfig) {
    this.publicKey = config.publicKey;
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    this.agentName = config.agentName;
    this.runId = config.runId;
    this.batchIntervalMs = config.batchIntervalMs ?? DEFAULT_INTERVAL_MS;
    this.maxBatchSize = config.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE;
    this.fetchFn = config.fetchFn ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);
    this.onError = config.onError;

    this.startTimer();
    this.setupBrowserListeners();
  }

  public updateContext = (context: { runId?: string; agentName?: string }): void => {
    if (context.runId !== undefined) {
      this.runId = context.runId;
    }
    if (context.agentName !== undefined) {
      this.agentName = context.agentName;
    }
  };

  public getRunId = (): string | undefined => this.runId;

  public getAgentName = (): string | undefined => this.agentName;

  private startTimer(): void {
    if (this.batchIntervalMs <= 0 || typeof setInterval === "undefined") {
      return;
    }
    this.timer = setInterval(() => {
      void this.flush();
    }, this.batchIntervalMs);
  }

  private setupBrowserListeners(): void {
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
      document.addEventListener("visibilitychange", this.handleVisibilityChange);
    }
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("beforeunload", this.handleBeforeUnload);
    }
  }

  public emit = (event: ClientTelemetryEvent): void => {
    if (this.isDestroyed) {
      return;
    }
    this.buffer.push(event);
    if (this.buffer.length >= this.maxBatchSize) {
      void this.flush();
    }
  };

  public flush = async (): Promise<void> => {
    if (this.isFlushing || this.buffer.length === 0 || !this.fetchFn) {
      return;
    }

    this.isFlushing = true;
    const batch = [...this.buffer];
    this.buffer = [];

    const payload: ClientTelemetryIngestPayload = {
      runId: this.runId,
      agentName: this.agentName,
      timestamp: new Date().toISOString(),
      events: batch,
    };

    try {
      await this.dispatchPayload(payload);
    } catch (err) {
      this.handleFlushError(err, batch);
    } finally {
      this.isFlushing = false;
    }
  };

  private dispatchPayload = async (payload: ClientTelemetryIngestPayload): Promise<void> => {
    if (!this.fetchFn) {
      throw new Error("No fetch implementation available in current environment");
    }

    const response = await this.fetchFn(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.publicKey}`,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });

    if (!response.ok) {
      throw new Error(`Browser telemetry ingestion failed: ${response.status} ${response.statusText}`);
    }
  };

  private handleFlushError = (err: unknown, failedBatch: ClientTelemetryEvent[]): void => {
    // Preserve failed events without exceeding batch size capacity
    if (!this.isDestroyed && this.buffer.length < this.maxBatchSize * 2) {
      this.buffer.unshift(...failedBatch);
    }
    const error = err instanceof Error ? err : new Error(String(err));
    if (this.onError) {
      this.onError(error);
    }
  };

  public destroy = (): void => {
    this.isDestroyed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    }
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("beforeunload", this.handleBeforeUnload);
    }
    void this.flush();
  };
}
