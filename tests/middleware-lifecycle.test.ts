import { z } from "zod";
import {
  createAvantGate,
  type LLMProviderPort,
  type AvantGateMiddleware,
  type LLMCompletionOptions,
} from "../src/index";

const assert = (condition: boolean, msg: string): void => {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
};

const createMockProvider = (handler: (opts: LLMCompletionOptions) => string): LLMProviderPort => ({
  name: "mock-provider",
  complete: async (opts) => ({
    text: handler(opts),
    usage: { promptTokens: 20, completionTokens: 10, totalTokens: 30 },
  }),
});

const runBeforeRequestMutationTest = async (): Promise<void> => {
  let capturedPrompt = "";
  const provider = createMockProvider((opts) => {
    capturedPrompt = opts.messages.map((m) => m.content).join(" | ");
    return "LLM response with augmented context";
  });

  const ragMiddleware: AvantGateMiddleware = {
    name: "rag-injector",
    beforeRequest: async ({ messages }) => ({
      messages: [
        { role: "system", content: "Internal Enterprise Knowledge: Prospect AI Alpha" },
        ...messages,
      ],
    }),
  };

  const gate = createAvantGate({
    primary: { provider: "custom", model: "custom-rag-model", client: provider },
    middlewares: [ragMiddleware],
  });

  const res = await gate.execute({ userQuery: "Tell me about the product" });
  assert(capturedPrompt.includes("Internal Enterprise Knowledge: Prospect AI Alpha"), "beforeRequest injected RAG context into messages");
  assert(res.text === "LLM response with augmented context", "LLM response successfully returned");
};

const runShortCircuitTest = async (): Promise<void> => {
  let providerCalled = false;
  const provider = createMockProvider(() => {
    providerCalled = true;
    return "This should not be called";
  });

  const cache = new Map<string, string>([
    ["cached-query", "Instant cached answer from local memory"],
  ]);

  const cacheMiddleware: AvantGateMiddleware = {
    name: "local-semantic-cache",
    beforeRequest: async ({ messages }) => {
      const last = messages[messages.length - 1];
      const hit = cache.get(last.content);
      if (hit) {
        return {
          shortCircuit: {
            text: hit,
            costUSD: 0,
          },
        };
      }
    },
  };

  const gate = createAvantGate({
    primary: { provider: "custom", model: "custom-cache-model", client: provider },
    middlewares: [cacheMiddleware],
  });

  const res = await gate.execute({ userQuery: "cached-query" });
  assert(!providerCalled, "Provider was completely bypassed by shortCircuit");
  assert(res.text === "Instant cached answer from local memory", "Cached text returned directly");
  assert(res.costUSD === 0, "Cost is 0 USD on short circuit");
  assert(res.attempts === 0, "Attempts count is 0 on short circuit");
  assert(res.modelUsed.includes(":shortcircuit"), "Model used is tagged as shortcircuit");
};

const runAfterResponseTransformationTest = async (): Promise<void> => {
  const provider = createMockProvider(() => "Raw model insight");

  const watermarkMiddleware: AvantGateMiddleware = {
    name: "compliance-watermark",
    afterResponse: async ({ responseText }) => ({
      responseText: `${responseText}\n---\n[AvantGate Verified - Prospect AI]`,
    }),
  };

  const gate = createAvantGate({
    primary: { provider: "custom", model: "custom-model", client: provider },
    middlewares: [watermarkMiddleware],
  });

  const res = await gate.execute({ userQuery: "Give me insight" });
  assert(res.text.includes("[AvantGate Verified - Prospect AI]"), "afterResponse mutated responseText with watermark");
};

const runSequentialMiddlewareChainTest = async (): Promise<void> => {
  const provider = createMockProvider(() => "Core answer");
  const executionOrder: string[] = [];

  const mw1: AvantGateMiddleware = {
    name: "mw-1",
    beforeRequest: async () => {
      executionOrder.push("before-1");
    },
    afterResponse: async () => {
      executionOrder.push("after-1");
    },
  };

  const mw2: AvantGateMiddleware = {
    name: "mw-2",
    beforeRequest: async () => {
      executionOrder.push("before-2");
    },
    afterResponse: async () => {
      executionOrder.push("after-2");
    },
  };

  const gate = createAvantGate({
    primary: { provider: "custom", model: "custom-chain-model", client: provider },
    middlewares: [mw1, mw2],
  });

  await gate.execute({ userQuery: "Order test" });
  assert(executionOrder[0] === "before-1" && executionOrder[1] === "before-2", "beforeRequest hooks ran in sequential order");
  assert(executionOrder[2] === "after-1" && executionOrder[3] === "after-2", "afterResponse hooks ran in sequential order");
};

const runOutputSecurityAfterMiddlewareTest = async (): Promise<void> => {
  const provider = createMockProvider(() => "Safe response");

  const leakyMiddleware: AvantGateMiddleware = {
    name: "accidental-leak",
    afterResponse: async () => ({
      responseText: "Response leaking key: sk-proj-1234567890abcdef1234567890abcdef",
    }),
  };

  const gate = createAvantGate({
    primary: { provider: "custom", model: "custom-leak-model", client: provider },
    security: { blockSecretLeaks: true, secretLeakAction: "REDACT" },
    middlewares: [leakyMiddleware],
  });

  const res = await gate.execute({ userQuery: "Safety test" });
  assert(!res.text.includes("sk-proj-1234567890abcdef1234567890abcdef"), "Secret injected by middleware was redacted by downstream DLP guard");
  assert(res.text.includes("[REDACTED_OPENAI_KEY]"), "Redacted key placeholder present");
};

const runStructuredOutputMiddlewareTest = async (): Promise<void> => {
  let providerInvoked = false;
  const provider = createMockProvider(() => {
    providerInvoked = true;
    return JSON.stringify({ score: 95, verdict: "ACCEPT" });
  });

  const structuredCacheMiddleware: AvantGateMiddleware = {
    name: "structured-cache",
    beforeRequest: async () => ({
      shortCircuit: {
        text: JSON.stringify({ score: 100, verdict: "CACHED_PERFECT" }),
        costUSD: 0,
      },
    }),
  };

  const gate = createAvantGate({
    primary: { provider: "custom", model: "custom-struct-model", client: provider },
    middlewares: [structuredCacheMiddleware],
  });

  const schema = z.object({
    score: z.number(),
    verdict: z.string(),
  });

  const res = await gate.generateStructuredOutput({
    messages: [{ role: "user", content: "Evaluate prospect" }],
    schema,
  });

  assert(!providerInvoked, "Structured output shortCircuit bypassed provider call");
  assert(res.data.score === 100 && res.data.verdict === "CACHED_PERFECT", "Structured schema parsed short-circuited payload");
};

const runCustomErrorInterruptionTest = async (): Promise<void> => {
  const provider = createMockProvider(() => "Never called");

  const guardMiddleware: AvantGateMiddleware = {
    name: "tenancy-firewall",
    beforeRequest: async () => {
      throw new Error("TENANT_POLICY_VIOLATION: Unauthorized domain");
    },
  };

  const gate = createAvantGate({
    primary: { provider: "custom", model: "custom-err-model", client: provider },
    middlewares: [guardMiddleware],
  });

  let threw = false;
  try {
    await gate.execute({ userQuery: "Blocked query" });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("TENANT_POLICY_VIOLATION")) {
      threw = true;
    }
  }
  assert(threw, "Custom exception thrown in middleware halts the execution pipeline");
};

const runAllMiddlewareTests = async (): Promise<void> => {
  console.log("🚀 Testing AvantGate Lifecycle Middleware Hooks (FEAT-033)...");
  await runBeforeRequestMutationTest();
  await runShortCircuitTest();
  await runAfterResponseTransformationTest();
  await runSequentialMiddlewareChainTest();
  await runOutputSecurityAfterMiddlewareTest();
  await runStructuredOutputMiddlewareTest();
  await runCustomErrorInterruptionTest();
  console.log("\n🎉 All Lifecycle Middleware Hook tests passed successfully!");
};

runAllMiddlewareTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
