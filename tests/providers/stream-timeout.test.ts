import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createHttpProviderClient,
  ProviderTTFTTimeoutError,
  ProviderIdleTimeoutError,
} from "../../src";

describe("FEAT-030: Transport Stream-First & Timeouts Dynamiques", () => {
  it("Critère 2.2: Déclenche ProviderTTFTTimeoutError si aucun octet n'est reçu avant expiration de ttftTimeoutMs", async () => {
    // Client configuré avec un timeout TTFT ultra court de 150ms vers un endpoint inexistant ou simulant un blocage
    const client = createHttpProviderClient({
      provider: "openai",
      model: "gpt-4o",
      baseUrl: "http://10.255.255.1:81/v1", // IP non routable provoquant un silence
      apiKey: "test-key",
      ttftTimeoutMs: 150,
      idleTimeoutMs: 500,
    });

    await assert.rejects(
      async () => {
        await client.complete({
          messages: [{ role: "user", content: "Hello" }],
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProviderTTFTTimeoutError);
        assert.equal(err.ttftTimeoutMs, 150);
        assert.match(err.message, /Time-to-First-Token/);
        return true;
      }
    );
  });

  it("Critère 2.1: Génération longue supportée sans coupure tant que les chunks arrivent avant l'idle timeout", async () => {
    // Mock global fetch avec ReadableStream simulant 3 tokens émis avec 100ms d'intervalle
    const originalFetch = globalThis.fetch;
    try {
      let intervalId: ReturnType<typeof setInterval>;
      globalThis.fetch = async () => {
        const stream = new ReadableStream({
          start(controller) {
            const chunks = [
              '{"choices":[{"message":{"content":"Part 1 "}}]}',
            ];
            let i = 0;
            intervalId = setInterval(() => {
              if (i < chunks.length) {
                controller.enqueue(new TextEncoder().encode(chunks[i]));
                i++;
              } else {
                clearInterval(intervalId);
                controller.close();
              }
            }, 80);
          },
          cancel() {
            clearInterval(intervalId);
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const client = createHttpProviderClient({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "test-key",
        ttftTimeoutMs: 1000,
        idleTimeoutMs: 500,
      });

      const res = await client.complete({
        messages: [{ role: "user", content: "Long task" }],
      });

      assert.equal(res.text, "Part 1 ");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("Déclenche ProviderIdleTimeoutError si le flux s'interrompt en cours de génération au-delà de idleTimeoutMs", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => {
        const stream = new ReadableStream({
          start(controller) {
            // Envoie un premier fragment (satisfait le TTFT)
            controller.enqueue(new TextEncoder().encode('{"choices":[{"message":{"content":"Start...'));
            // Puis silence complet (pas de close, pas de nouveaux paquets)
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const client = createHttpProviderClient({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "test-key",
        ttftTimeoutMs: 1000,
        idleTimeoutMs: 150, // Idle timeout de 150ms
      });

      await assert.rejects(
        async () => {
          await client.complete({
            messages: [{ role: "user", content: "Hanging mid-stream" }],
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof ProviderIdleTimeoutError);
          assert.equal(err.idleTimeoutMs, 150);
          assert.match(err.message, /Idle read timeout/);
          return true;
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
