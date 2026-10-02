import { describe, it } from "node:test";
import assert from "node:assert";
import { telemetryStore } from "../lib/storage/telemetry-store";
import { TelemetryIngestPayload } from "../lib/types/telemetry";

describe("GateWall Cockpit — Ingest batchId Idempotency & FinOps Deduplication (FEAT-028)", () => {
  it("First Ingestion: processes batch and records FinOps tokens and costs", () => {
    const runId = `run_dedup_test_${Date.now()}`;
    const batchId = `batch_token_calc_${Date.now()}_1`;

    const payload: TelemetryIngestPayload = {
      batchId,
      runId,
      agentName: "finops-guardian",
      timestamp: new Date().toISOString(),
      usage: {
        model: "gpt-4o-mini",
        promptTokens: 500,
        completionTokens: 200,
        totalTokens: 700,
        costUsd: 0.000195,
      },
      events: [
        {
          type: "TOOL_EXECUTION",
          toolId: "analyze_budget",
          toolName: "analyze_budget",
          depth: 1,
          durationMs: 150,
          success: true,
          piiFilteredCount: 0,
          costUsd: 0.0001,
          cached: false,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const session = telemetryStore.ingest(payload);

    assert.strictEqual(session.runId, runId);
    assert.strictEqual(session.totalTokens, 700);
    assert.strictEqual(session.totalCostUsd, 0.000195);
    assert.strictEqual(session.eventsCount, 1);
    assert.strictEqual(telemetryStore.isBatchProcessed(batchId), true);
  });

  it("Network Retry with Identical batchId: short-circuits and prevents FinOps overcounting", () => {
    const runId = `run_retry_dedup_${Date.now()}`;
    const duplicateBatchId = `batch_retry_key_${Date.now()}`;

    const initialPayload: TelemetryIngestPayload = {
      batchId: duplicateBatchId,
      runId,
      agentName: "billing-agent",
      timestamp: new Date().toISOString(),
      usage: {
        model: "gpt-4o-mini",
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        costUsd: 0.00045,
      },
      events: [
        {
          type: "STEP_COMPLETED",
          stepName: "calculate_invoice",
          durationMs: 300,
          piiDetectedCount: 0,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    // First attempt succeeds
    const firstResult = telemetryStore.ingest(initialPayload);
    assert.strictEqual(firstResult.totalTokens, 1500);
    assert.strictEqual(firstResult.totalCostUsd, 0.00045);
    assert.strictEqual(firstResult.eventsCount, 1);

    // Second attempt with exact same batchId (e.g. client dropped TCP socket before receiving 200 OK)
    const duplicatePayload: TelemetryIngestPayload = {
      ...initialPayload,
      events: [...initialPayload.events],
    };

    const secondResult = telemetryStore.ingest(duplicatePayload);

    // CRITICAL FINOPS ASSERTIONS:
    // Total tokens must NOT have doubled to 3000!
    assert.strictEqual(secondResult.totalTokens, 1500, "Tokens must not be doubled on retry");
    // Cost must NOT have doubled to 0.00090!
    assert.strictEqual(secondResult.totalCostUsd, 0.00045, "Cost must not be doubled on retry");
    // Events must NOT be duplicated in session history
    assert.strictEqual(secondResult.eventsCount, 1, "Events count must not be incremented on retry");
    assert.strictEqual(secondResult.events.length, 1);
  });

  it("Sequential Batch with Distinct batchId: accumulates tokens and events normally", () => {
    const runId = `run_multi_step_${Date.now()}`;
    const batch1 = `batch_step_1_${Date.now()}`;
    const batch2 = `batch_step_2_${Date.now()}`;

    // Step 1
    const res1 = telemetryStore.ingest({
      batchId: batch1,
      runId,
      agentName: "workflow-runner",
      timestamp: new Date().toISOString(),
      usage: {
        model: "gpt-4o-mini",
        promptTokens: 200,
        completionTokens: 100,
        totalTokens: 300,
        costUsd: 0.00009,
      },
      events: [
        {
          type: "STEP_COMPLETED",
          stepName: "step_one",
          durationMs: 100,
          piiDetectedCount: 0,
          timestamp: new Date().toISOString(),
        },
      ],
    });
    assert.strictEqual(res1.totalTokens, 300);

    // Step 2 with new batchId
    const res2 = telemetryStore.ingest({
      batchId: batch2,
      runId,
      agentName: "workflow-runner",
      timestamp: new Date().toISOString(),
      usage: {
        model: "gpt-4o-mini",
        promptTokens: 400,
        completionTokens: 100,
        totalTokens: 500,
        costUsd: 0.00012,
      },
      events: [
        {
          type: "STEP_COMPLETED",
          stepName: "step_two",
          durationMs: 120,
          piiDetectedCount: 0,
          timestamp: new Date().toISOString(),
        },
      ],
    });

    // Legitimate distinct batch: accumulates tokens (300 + 500 = 800)
    assert.strictEqual(res2.totalTokens, 800);
    assert.strictEqual(res2.eventsCount, 2);
  });
});
