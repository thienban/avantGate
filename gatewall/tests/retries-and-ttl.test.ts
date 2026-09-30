import { describe, it } from "node:test";
import assert from "node:assert";
import { telemetryStore } from "../lib/storage/telemetry-store";
import { TelemetryIngestPayload } from "../lib/types/telemetry";

describe("GateWall Cockpit — Retries Observability, Replay Transitions & TTL (FEAT-026)", () => {
  it("Telemetry Ingestion: captures attempts and sets hasRetriesOccurred", () => {
    const payload: TelemetryIngestPayload = {
      runId: `run_retry_test_${Date.now()}`,
      agentName: "prospect-scraper",
      timestamp: new Date().toISOString(),
      events: [
        {
          type: "TOOL_EXECUTION",
          toolId: "crm_search",
          toolName: "crm_search",
          depth: 1,
          durationMs: 450,
          success: true,
          piiFilteredCount: 0,
          costUsd: 0.0001,
          cached: false,
          attempts: 3,
          maxRetries: 3,
          retriedErrors: ["HTTP 429", "HTTP 429"],
          timestamp: new Date().toISOString(),
        },
        {
          type: "STEP_COMPLETED",
          stepName: "search_leads",
          durationMs: 450,
          piiDetectedCount: 0,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const session = telemetryStore.ingest(payload);

    assert.strictEqual(session.hasRetriesOccurred, true);
    assert.strictEqual(session.status, "COMPLETED");
    const toolEvent = session.events.find((e) => e.type === "TOOL_EXECUTION") as any;
    assert.strictEqual(toolEvent.attempts, 3);
    assert.deepStrictEqual(toolEvent.retriedErrors, ["HTTP 429", "HTTP 429"]);
  });

  it("Session Replay Flow: FAILED ➔ RETRYING ➔ RECOVERED lifecycle", () => {
    const parentRunId = `run_origin_fail_${Date.now()}`;
    const replayedRunId = `run_replayed_success_${Date.now()}`;

    // 1. Initial run fails
    const failPayload: TelemetryIngestPayload = {
      runId: parentRunId,
      agentName: "invoice-bot",
      timestamp: new Date().toISOString(),
      events: [
        {
          type: "STEP_FAILED",
          stepName: "generate_pdf",
          error: "Out of memory",
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const failedSession = telemetryStore.ingest(failPayload);
    assert.strictEqual(failedSession.status, "FAILED");

    // 2. Client initiates retry (running)
    const runningRetryPayload: TelemetryIngestPayload = {
      runId: replayedRunId,
      agentName: "invoice-bot",
      timestamp: new Date().toISOString(),
      metadata: { retryOf: parentRunId },
      events: [
        {
          type: "STEP_START",
          stepName: "generate_pdf",
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const runningRetrySession = telemetryStore.ingest(runningRetryPayload);
    assert.strictEqual(runningRetrySession.status, "RUNNING");

    // Verify parent transitioned to RETRYING
    const parentInRetrying = telemetryStore.getSession(parentRunId);
    assert.strictEqual(parentInRetrying?.status, "RETRYING");
    assert.strictEqual(parentInRetrying?.metadata?.replayedBy, replayedRunId);

    // 3. Retry completes successfully
    const completedRetryPayload: TelemetryIngestPayload = {
      runId: replayedRunId,
      agentName: "invoice-bot",
      timestamp: new Date().toISOString(),
      metadata: { retryOf: parentRunId },
      events: [
        {
          type: "STEP_COMPLETED",
          stepName: "generate_pdf",
          durationMs: 300,
          piiDetectedCount: 0,
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const completedRetrySession = telemetryStore.ingest(completedRetryPayload);
    assert.strictEqual(completedRetrySession.status, "COMPLETED");

    // Verify parent transitioned to RECOVERED
    const parentRecovered = telemetryStore.getSession(parentRunId);
    assert.strictEqual(parentRecovered?.status, "RECOVERED");
    assert.strictEqual(parentRecovered?.metadata?.replayedBy, replayedRunId);
  });

  it("HITL Auto-Expiration: cleans approvals older than maxAgeMs and marks session FAILED", () => {
    const runId = `run_hitl_zombie_${Date.now()}`;

    // 1. Ingest approval request
    telemetryStore.ingest({
      runId,
      agentName: "payment-agent",
      timestamp: new Date().toISOString(),
      events: [
        {
          type: "STEP_APPROVAL_REQUEST",
          stepName: "transfer_funds",
          actionType: "FINANCIAL_TRANSFER",
          payloadSummary: { amount: 5000 },
          timestamp: new Date().toISOString(),
        },
      ],
    });

    const sessionBefore = telemetryStore.getSession(runId);
    assert.strictEqual(sessionBefore?.status, "WAITING_APPROVAL");

    const approvalsBefore = telemetryStore.getApprovals().filter((a) => a.runId === runId);
    assert.strictEqual(approvalsBefore.length, 1);
    assert.strictEqual(approvalsBefore[0].status, "PENDING");

    // 2. Trigger TTL cleanup with maxAgeMs = -1 (immediate expiration)
    const expiredList = telemetryStore.cleanExpiredApprovals(-1);

    const expiredItem = expiredList.find((a) => a.runId === runId);
    assert.ok(expiredItem, "Expected approval to be expired");
    assert.strictEqual(expiredItem!.status, "REJECTED");
    assert.strictEqual(expiredItem!.decidedBy, "System (TTL)");
    assert.match(expiredItem!.reason!, /Auto-expired/);

    // 3. Verify session transitioned to FAILED
    const sessionAfter = telemetryStore.getSession(runId);
    assert.strictEqual(sessionAfter?.status, "FAILED");
  });

  it("Security Hardening: prevents cross-tenant replay binding (Anti-IDOR)", () => {
    const victimRunId = `run_tenant_alpha_transfer_${Date.now()}`;
    const attackerRunId = `run_tenant_beta_replay_${Date.now()}`;

    // 1. Tenant Alpha runs critical transfer that fails
    telemetryStore.ingest({
      runId: victimRunId,
      agentName: "finance-agent",
      tenantId: "tenant_alpha",
      taskId: "tsk_wire_transfer",
      timestamp: new Date().toISOString(),
      metadata: {
        tenantId: "tenant_alpha",
        taskId: "tsk_wire_transfer",
      },
      events: [
        {
          type: "STEP_FAILED",
          stepName: "execute_wire_transfer",
          error: "Connection timeout to bank portal",
          timestamp: new Date().toISOString(),
        },
      ],
    });

    const victimSession = telemetryStore.getSession(victimRunId);
    assert.strictEqual(victimSession?.status, "FAILED");

    // 2. Tenant Beta attempts to replay victim's session
    const attackerSession = telemetryStore.ingest({
      runId: attackerRunId,
      agentName: "finance-agent",
      tenantId: "tenant_beta", // Different tenant!
      taskId: "tsk_wire_transfer",
      timestamp: new Date().toISOString(),
      metadata: {
        tenantId: "tenant_beta",
        taskId: "tsk_wire_transfer",
        retryOf: victimRunId, // Malicious replay binding targeting victim
      },
      events: [
        {
          type: "STEP_COMPLETED",
          stepName: "execute_wire_transfer",
          durationMs: 100,
          piiDetectedCount: 0,
          timestamp: new Date().toISOString(),
        },
      ],
    });

    assert.strictEqual(attackerSession.status, "COMPLETED");

    // 3. Verify victim session was NOT hijacked or marked as RECOVERED!
    const victimAfterAttack = telemetryStore.getSession(victimRunId);
    assert.strictEqual(victimAfterAttack?.status, "FAILED", "Cross-tenant replay MUST NOT change victim session status");
    assert.notStrictEqual(victimAfterAttack?.metadata?.replayedBy, attackerRunId, "Victim session MUST NOT link attacker runId");
  });

  it("Security Hardening: prevents cross-task replay binding (Semantic Confusion)", () => {
    const parentRunId = `run_transfer_failed_${Date.now()}`;
    const avatarRunId = `run_avatar_success_${Date.now()}`;

    // 1. Critical transfer task fails
    telemetryStore.ingest({
      runId: parentRunId,
      agentName: "core-agent",
      tenantId: "tenant_acme",
      taskId: "tsk_wire_transfer_123",
      timestamp: new Date().toISOString(),
      metadata: {
        tenantId: "tenant_acme",
        taskId: "tsk_wire_transfer_123",
      },
      events: [
        {
          type: "STEP_FAILED",
          stepName: "wire_transfer",
          error: "Insufficient funds",
          timestamp: new Date().toISOString(),
        },
      ],
    });

    // 2. Trivial avatar update task succeeds with retryOf pointing to wire transfer
    telemetryStore.ingest({
      runId: avatarRunId,
      agentName: "core-agent",
      tenantId: "tenant_acme",
      taskId: "tsk_update_avatar_456", // Different task!
      timestamp: new Date().toISOString(),
      metadata: {
        tenantId: "tenant_acme",
        taskId: "tsk_update_avatar_456",
        retryOf: parentRunId,
      },
      events: [
        {
          type: "STEP_COMPLETED",
          stepName: "avatar_upload",
          durationMs: 50,
          piiDetectedCount: 0,
          timestamp: new Date().toISOString(),
        },
      ],
    });

    // 3. Verify transfer task status remains FAILED and was NOT modified by avatar task
    const parentSession = telemetryStore.getSession(parentRunId);
    assert.strictEqual(parentSession?.status, "FAILED", "Mismatched taskId MUST NOT transition parent status");
    assert.notStrictEqual(parentSession?.metadata?.replayedBy, avatarRunId);
  });

  it("Security Hardening: sanitizes sensitive tokens, API keys and DB credentials in retriedErrors", () => {
    const runId = `run_leak_test_${Date.now()}`;

    telemetryStore.ingest({
      runId,
      agentName: "auth-agent",
      timestamp: new Date().toISOString(),
      events: [
        {
          type: "TOOL_EXECUTION",
          toolId: "call_external_service",
          toolName: "external_service",
          depth: 1,
          durationMs: 200,
          piiFilteredCount: 0,
          costUsd: 0,
          cached: false,
          attempts: 2,
          maxRetries: 2,
          success: false,
          retriedErrors: [
            "HTTP 401 Unauthorized: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token123",
            "OpenAI API request failed with key ak_live_abcdef1234567890abcdef123456",
            "Database error connecting to postgres://postgres:supersecretpassword@db.internal:5432/main",
          ],
          timestamp: new Date().toISOString(),
        },
        {
          type: "STEP_FAILED",
          stepName: "auth_step",
          error: "Tool execution failed",
          timestamp: new Date().toISOString(),
        },
      ],
    });

    const session = telemetryStore.getSession(runId);
    assert.ok(session?.retriedErrors);
    assert.strictEqual(session!.retriedErrors!.length, 3);

    // Verify all sensitive elements are redacted
    assert.ok(!session!.retriedErrors![0].includes("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token123"));
    assert.ok(session!.retriedErrors![0].includes("[REDACTED_TOKEN]"));

    assert.ok(!session!.retriedErrors![1].includes("ak_live_abcdef1234567890abcdef123456"));
    assert.ok(session!.retriedErrors![1].includes("[REDACTED_API_KEY]"));

    assert.ok(!session!.retriedErrors![2].includes("supersecretpassword"));
    assert.ok(session!.retriedErrors![2].includes("[REDACTED_PASSWORD]"));
  });
});
