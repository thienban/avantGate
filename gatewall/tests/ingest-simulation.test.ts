import { describe, it } from "node:test";
import assert from "node:assert";
import { calculateFallbackTokenCost } from "../lib/finops/fallback-cost-calculator";
import { detectInfiniteLoop } from "../lib/finops/loop-shield";
import { auditDualChannelSeparation } from "../lib/security/pii-auditor";
import { TelemetryIngestPayloadSchema, ToolExecutionEvent } from "../lib/types/telemetry";

describe("avantGate Control Plane - Core Ingestion & FinOps Engine", () => {
  it("FinOps Cost Calculator: computes precise cost for GPT-4o-mini", () => {
    const cost = calculateFallbackTokenCost("gpt-4o-mini", 1000, 500);
    assert.strictEqual(Number(cost.toFixed(5)), 0.00045);
  });

  it("Infinite Loop Shield: detects 3 identical consecutive tool calls", () => {
    const identicalCalls: ToolExecutionEvent[] = [
      {
        type: "TOOL_EXECUTION",
        toolId: "t1",
        toolName: "fetchData",
        depth: 1,
        durationMs: 200,
        success: true,
        piiFilteredCount: 0,
        costUsd: 0.0001,
        cached: false,
        llmSummary: { page: 1 },
        timestamp: new Date().toISOString(),
      },
      {
        type: "TOOL_EXECUTION",
        toolId: "t2",
        toolName: "fetchData",
        depth: 1,
        durationMs: 210,
        success: true,
        piiFilteredCount: 0,
        costUsd: 0.0001,
        cached: false,
        llmSummary: { page: 1 },
        timestamp: new Date().toISOString(),
      },
      {
        type: "TOOL_EXECUTION",
        toolId: "t3",
        toolName: "fetchData",
        depth: 1,
        durationMs: 205,
        success: true,
        piiFilteredCount: 0,
        costUsd: 0.0001,
        cached: false,
        llmSummary: { page: 1 },
        timestamp: new Date().toISOString(),
      },
    ];

    const result = detectInfiniteLoop(identicalCalls);
    assert.strictEqual(result.isLoopDetected, true);
    assert.strictEqual(result.toolName, "fetchData");
    assert.strictEqual(result.consecutiveCount, 3);
  });

  it("Dual-Channel PII Auditor: passes when raw PII is not leaked to LLM summary", () => {
    const raw = { email: "ceo@acme.com", phone: "+33612345678" };
    const sanitized = { leadScore: 92, verifiedDomain: "acme.com" };

    const report = auditDualChannelSeparation(raw, sanitized, 2);
    assert.strictEqual(report.isCompliant, true);
    assert.strictEqual(report.scorePercent, 100);
    assert.strictEqual(report.unmaskedLeakCount, 0);
  });

  it("Telemetry Schema: validates official SDK FEAT-008 format", () => {
    const payload = {
      runId: "run_test_valid",
      agentName: "prospect-qualifier",
      timestamp: new Date().toISOString(),
      events: [
        {
          type: "STEP_START",
          stepName: "init-step",
          timestamp: new Date().toISOString(),
        },
        {
          type: "STEP_APPROVAL_REQUEST",
          stepName: "send-email-step",
          actionType: "SEND_CAMPAIGN_EMAIL",
          payloadSummary: { recipientDomain: "acme.com" },
          timestamp: new Date().toISOString(),
        },
      ],
      usage: {
        model: "gpt-4o-mini",
        promptTokens: 500,
        completionTokens: 100,
        totalTokens: 600,
        costUsd: 0.000135,
      },
    };

    const parseResult = TelemetryIngestPayloadSchema.safeParse(payload);
    assert.strictEqual(parseResult.success, true);
  });
});
