import { realtimeEmitter } from "@/lib/sse/event-emitter";

export const dynamic = "force-dynamic";

export const GET = async (): Promise<Response> => {
  let unsubscribe: (() => void) | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Initial connection ping
      controller.enqueue(encoder.encode("event: connected\ndata: {}\n\n"));

      // Subscribe to internal broadcasts
      unsubscribe = realtimeEmitter.subscribe((message) => {
        try {
          controller.enqueue(encoder.encode(message));
        } catch {
          // Stream might be closed
        }
      });

      // Heartbeat ping every 15s
      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
        }
      }, 15000);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
};
