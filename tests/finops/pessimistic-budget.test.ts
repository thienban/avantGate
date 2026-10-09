import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createAvantGate, BudgetExceededError, LLMProviderPort, LLMCompletionOptions } from "../../src";

describe("FEAT-030: Pessimistic FinOps Reservations (In-Process)", () => {
  it("Critère 1.1: Success transitions reservation to SETTLED with settledCostUsd", async () => {
    const mockClient: LLMProviderPort = {
      name: "mock-llm",
      complete: async () => ({
        text: "Paris",
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      }),
    };

    const gate = createAvantGate({
      primary: {
        provider: "openai",
        model: "gpt-4o",
        client: mockClient,
      },
      customPricing: {
        "gpt-4o": { promptUSDPerMillion: 5.0, completionUSDPerMillion: 15.0 },
      },
      maxCostUSD: 0.1,
    });

    const res = await gate.execute({
      userQuery: "What is the capital of France?",
      metadata: { parentRunId: "run_test_settle_1" },
    });

    assert.equal(res.text, "Paris");
    const reservations = gate.getAllReservations();
    assert.equal(reservations.length, 1);
    const hold = reservations[0];
    assert.equal(hold.status, "SETTLED");
    assert.equal(hold.parentRunId, "run_test_settle_1");
    assert.ok(hold.settledCostUsd !== undefined && hold.settledCostUsd > 0);
  });

  it("Critère 1.2: Deterministic 4xx client error transitions reservation to RELEASED", async () => {
    const failingClient: LLMProviderPort = {
      name: "failing-llm",
      complete: async () => {
        throw new Error("[AvantGate HTTP Provider openai] HTTP 400 Bad Request: Invalid model parameters");
      },
    };

    const gate = createAvantGate({
      primary: {
        provider: "openai",
        model: "gpt-4o",
        client: failingClient,
      },
      customPricing: {
        "gpt-4o": { promptUSDPerMillion: 5.0, completionUSDPerMillion: 15.0 },
      },
      maxCostUSD: 0.1,
    });

    await assert.rejects(
      async () => {
        await gate.execute({
          userQuery: "Trigger 400 error",
          metadata: { parentRunId: "run_test_release_1" },
        });
      },
      /HTTP 400/
    );

    const reservations = gate.getAllReservations();
    assert.equal(reservations.length, 1);
    const hold = reservations[0];
    assert.equal(hold.status, "RELEASED");
  });

  it("Critère 1.3: Ambiguous timeout transitions reservation to UNCONFIRMED_TIMEOUT", async () => {
    const timeoutClient: LLMProviderPort = {
      name: "timeout-llm",
      complete: async () => {
        throw new Error("FetchError: ETIMEDOUT socket connection dropped");
      },
    };

    const gate = createAvantGate({
      primary: {
        provider: "openai",
        model: "gpt-4o",
        client: timeoutClient,
      },
      customPricing: {
        "gpt-4o": { promptUSDPerMillion: 5.0, completionUSDPerMillion: 15.0 },
      },
      maxCostUSD: 0.1,
    });

    await assert.rejects(
      async () => {
        await gate.execute({
          userQuery: "Trigger timeout error",
          metadata: { parentRunId: "run_test_timeout_1" },
        });
      },
      /ETIMEDOUT/
    );

    const reservations = gate.getAllReservations();
    assert.equal(reservations.length, 1);
    const hold = reservations[0];
    assert.equal(hold.status, "UNCONFIRMED_TIMEOUT");
  });

  it("Critère 1.4: Fail-closed rejection upon retry when cumulative worst-case exceeds budget", async () => {
    let callCount = 0;
    const flappyClient: LLMProviderPort = {
      name: "flappy-llm",
      complete: async () => {
        callCount++;
        throw new Error("NetworkTimeout: socket hung up");
      },
    };

    // Prompt ~68 chars => ~17 tokens.
    // promptUSDPerMillion: 1_000 => (17 / 1_000_000) * 1_000 = $0.017
    // maxCostUSD = 0.025
    // Tentative 1 : estimatedCost = 0.017 <= 0.025 (Passe le preflight, puis subit le timeout => UNCONFIRMED_TIMEOUT)
    // Tentative 2 : 2 * estimatedCost = 0.034 > 0.025 (Doit être rejeté au preflight avec BudgetExceededError)
    const gate = createAvantGate({
      primary: {
        provider: "openai",
        model: "custom-heavy",
        client: flappyClient,
      },
      customPricing: {
        "custom-heavy": { promptUSDPerMillion: 1_000, completionUSDPerMillion: 2_000 },
      },
      maxCostUSD: 0.025,
    });

    const parentRunId = "run_causal_retry_budget_fail";

    // 1ère tentative (subit le timeout)
    await assert.rejects(
      async () => {
        await gate.execute({
          userQuery: "Calculate comprehensive multi-variable financial optimization matrix",
          metadata: { parentRunId },
        });
      },
      /NetworkTimeout/
    );
    assert.equal(callCount, 1);

    // 2ème tentative (doit échouer dès le preflight budget guard SANS appeler flappyClient)
    await assert.rejects(
      async () => {
        await gate.execute({
          userQuery: "Calculate comprehensive multi-variable financial optimization matrix",
          metadata: { parentRunId },
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof BudgetExceededError);
        assert.match(err.message, /worst-case cumulative spend/);
        return true;
      }
    );

    // Le fournisseur n'a pas été appelé une 2ème fois (préservation FinOps)
    assert.equal(callCount, 1);
  });

  it("Gère le cycle de vie SETTLED dans generateStructuredOutput", async () => {
    const { z } = await import("zod");
    const mockStructuredClient: LLMProviderPort = {
      name: "mock-structured",
      complete: async () => ({
        text: JSON.stringify({ score: 98, verified: true }),
        usage: { promptTokens: 12, completionTokens: 8, totalTokens: 20 },
      }),
    };

    const gate = createAvantGate({
      primary: { provider: "openai", model: "gpt-4o", client: mockStructuredClient },
      customPricing: { "gpt-4o": { promptUSDPerMillion: 5.0, completionUSDPerMillion: 15.0 } },
      maxCostUSD: 0.1,
    });

    const schema = z.object({ score: z.number(), verified: z.boolean() });
    const result = await gate.generateStructuredOutput({
      messages: [{ role: "user", content: "Evaluate score" }],
      schema,
      schemaName: "EvaluationResult",
    });

    assert.equal(result.data.score, 98);
    assert.equal(result.data.verified, true);

    const reservations = gate.getAllReservations();
    assert.equal(reservations.length, 1);
    assert.equal(reservations[0].status, "SETTLED");
    assert.ok((reservations[0].settledCostUsd ?? 0) > 0);
  });
});

