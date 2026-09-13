import type {
  HttpTelemetryExporterOptions,
  TelemetryEvent,
  TelemetryIngestPayload,
  TelemetryUsageSummary,
} from "./types";

interface QueuedItem {
  runId: string;
  event: TelemetryEvent;
  usage?: TelemetryUsageSummary;
}

const DEFAULT_ENDPOINT = "https://api.avantgate.cloud/api/v1/ingest/events";
const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_MAX_BATCH = 50;
const DEFAULT_MAX_QUEUE = 1000;

function aggregateUsage(items: QueuedItem[]): TelemetryUsageSummary | undefined {
  let prompt = 0;
  let completion = 0;
  let total = 0;
  let cost = 0;
  let hasUsage = false;

  for (const item of items) {
    if (!item.usage) continue;
    hasUsage = true;
    prompt += item.usage.promptTokens ?? 0;
    completion += item.usage.completionTokens ?? 0;
    total += item.usage.totalTokens ?? 0;
    cost += item.usage.costUsd ?? 0;
  }

  if (!hasUsage) return undefined;
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total, costUsd: cost };
}

function buildPayloads(
  items: QueuedItem[],
  agentName?: string
): TelemetryIngestPayload[] {
  const grouped = new Map<string, QueuedItem[]>();
  for (const item of items) {
    const list = grouped.get(item.runId) ?? [];
    list.push(item);
    grouped.set(item.runId, list);
  }

  const payloads: TelemetryIngestPayload[] = [];
  for (const [runId, runItems] of grouped.entries()) {
    payloads.push({
      runId,
      agentName,
      timestamp: new Date().toISOString(),
      events: runItems.map((ri) => ri.event),
      usage: aggregateUsage(runItems),
    });
  }
  return payloads;
}

async function sendPayload(
  payload: TelemetryIngestPayload,
  endpoint: string,
  apiKey: string,
  fetchFn: typeof fetch
): Promise<void> {
  const response = await fetchFn(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Telemetry ingestion failed: ${response.status} ${response.statusText}`);
  }
}

/**
 * Asynchronous, zero-dependency HTTP Telemetry Exporter for the avantGate platform.
 * Batches events in memory and sends them in background without blocking agent execution.
 */
export class HttpTelemetryExporter {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly agentName?: string;
  private readonly batchIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly maxQueueSize: number;
  private readonly fetchFn: typeof fetch;
  private readonly onError?: (error: Error) => void;

  private queue: QueuedItem[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private isFlushing = false;

  constructor(options: HttpTelemetryExporterOptions) {
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.agentName = options.agentName;
    this.batchIntervalMs = options.batchIntervalMs ?? DEFAULT_INTERVAL_MS;
    this.maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH;
    this.maxQueueSize = options.maxQueueSize ?? DEFAULT_MAX_QUEUE;
    this.fetchFn = options.fetchFn ?? globalThis.fetch;
    this.onError = options.onError;

    this.startTimer();
  }

  private startTimer(): void {
    if (this.batchIntervalMs <= 0) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.batchIntervalMs);

    if (this.timer && typeof this.timer === "object" && "unref" in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  public enqueue(
    runId: string,
    event: TelemetryEvent,
    usage?: TelemetryUsageSummary
  ): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift();
    }
    this.queue.push({ runId, event, usage });

    if (this.queue.length >= this.maxBatchSize) {
      void this.flush();
    }
  }

  public async flush(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0) return;
    this.isFlushing = true;

    const toProcess = this.queue.splice(0, this.maxBatchSize);
    const payloads = buildPayloads(toProcess, this.agentName);

    let hadError = false;
    try {
      await Promise.all(
        payloads.map((p) =>
          sendPayload(p, this.endpoint, this.apiKey, this.fetchFn)
        )
      );
    } catch (err) {
      hadError = true;
      const error = err instanceof Error ? err : new Error(String(err));
      this.onError?.(error);
    } finally {
      this.isFlushing = false;
      if (!hadError && this.queue.length > 0) {
        void this.flush();
      }
    }
  }

  public async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}
