type SSEListener = (data: string) => void;

class RealtimeEventEmitter {
  private listeners: Set<SSEListener> = new Set();

  public subscribe(listener: SSEListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public broadcast(eventType: string, payload: unknown): void {
    const message = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const listener of this.listeners) {
      try {
        listener(message);
      } catch (err) {
        console.error("SSE broadcast error:", err);
      }
    }
  }
}

const globalForSSE = globalThis as unknown as { realtimeEmitter: RealtimeEventEmitter | undefined };
export const realtimeEmitter = globalForSSE.realtimeEmitter ?? new RealtimeEventEmitter();
if (process.env.NODE_ENV !== "production") {
  globalForSSE.realtimeEmitter = realtimeEmitter;
}
