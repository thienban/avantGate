import { describe, it } from "node:test";
import assert from "node:assert";
import { auth } from "../lib/auth";
import {
  ClientDataRenderedEventSchema,
  ClientSecurityAlertEventSchema,
  UserFeedbackEventSchema,
} from "../lib/types/telemetry";
import { telemetryStore } from "../lib/storage/telemetry-store";
import { createBrowserTelemetryExporter } from "../lib/telemetry/browser-exporter";

describe("FEAT-011: Web Client Extension & In-Browser Telemetry Suite", () => {
  it("Auth Service: verifies server key with gw_live_ prefix and full scopes", async () => {
    const headers = new Headers({
      Authorization: "Bearer gw_live_dev_test_key_123456789",
    });
    const result = await auth.api.verifyApiKey({ headers });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.key?.prefix, "gw_live_");
    assert.strictEqual(result.key?.scopes.includes("telemetry:ingest"), true);
  });

  it("Auth Service: verifies public key with gw_pub_ prefix and client scope only", async () => {
    const headers = new Headers({
      Authorization: "Bearer gw_pub_prospect_ai_123456789",
    });
    const result = await auth.api.verifyApiKey({ headers });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.key?.prefix, "gw_pub_");
    assert.deepStrictEqual(result.key?.scopes, ["telemetry:client:ingest"]);
  });

  it("Auth Service: rejects invalid or missing token", async () => {
    const emptyHeaders = new Headers();
    const emptyResult = await auth.api.verifyApiKey({ headers: emptyHeaders });
    assert.strictEqual(emptyResult.valid, false);

    const invalidHeaders = new Headers({ Authorization: "Bearer invalid_key_without_prefix" });
    const invalidResult = await auth.api.verifyApiKey({ headers: invalidHeaders });
    assert.strictEqual(invalidResult.valid, false);
  });

  it("Zod Schema: validates CLIENT_DATA_RENDERED event (toClientData acknowledgment)", () => {
    const event = {
      type: "CLIENT_DATA_RENDERED",
      toolId: "searchCRM",
      channel: "HTTP",
      renderedItemCount: 5,
      timestamp: new Date().toISOString(),
    };
    const parsed = ClientDataRenderedEventSchema.safeParse(event);
    assert.strictEqual(parsed.success, true);
  });

  it("Zod Schema: validates CLIENT_SECURITY_ALERT event (In-Browser Pre-Flight Check)", () => {
    const event = {
      type: "CLIENT_SECURITY_ALERT",
      alertType: "SUSPECTED_SECRET_INPUT",
      inputLength: 52,
      matchedPatternSnippet: "sk-ant-api03-ab...",
      timestamp: new Date().toISOString(),
    };
    const parsed = ClientSecurityAlertEventSchema.safeParse(event);
    assert.strictEqual(parsed.success, true);
  });

  it("Zod Schema: validates USER_FEEDBACK event (Rating & Review)", () => {
    const event = {
      type: "USER_FEEDBACK",
      rating: "POSITIVE",
      feedbackTag: "HELPFUL",
      userComment: "Fiches de prospects précises et sans fuite !",
      timestamp: new Date().toISOString(),
    };
    const parsed = UserFeedbackEventSchema.safeParse(event);
    assert.strictEqual(parsed.success, true);
  });

  it("Telemetry Store: tracks clientSecurityAlertsCount and userFeedback", () => {
    const runId = `test-client-run-${Date.now()}`;
    const payload = {
      runId,
      agentName: "prospect-qualifier",
      timestamp: new Date().toISOString(),
      events: [
        {
          type: "CLIENT_SECURITY_ALERT" as const,
          alertType: "POTENTIAL_PROMPT_INJECTION" as const,
          inputLength: 60,
          matchedPatternSnippet: "ignore previous...",
          timestamp: new Date().toISOString(),
        },
        {
          type: "CLIENT_DATA_RENDERED" as const,
          toolId: "crm_lookup",
          channel: "HTTP" as const,
          renderedItemCount: 3,
          timestamp: new Date().toISOString(),
        },
        {
          type: "USER_FEEDBACK" as const,
          rating: "POSITIVE" as const,
          feedbackTag: "HELPFUL" as const,
          userComment: "Top",
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const session = telemetryStore.ingest(payload);
    assert.strictEqual(session.runId, runId);
    assert.strictEqual(session.clientSecurityAlertsCount, 1);
    assert.strictEqual(session.clientDataRenderedCount, 1);
    assert.strictEqual(session.userFeedback?.rating, "POSITIVE");
    assert.strictEqual(session.userFeedback?.tag, "HELPFUL");
  });

  it("Browser Exporter: queues events and respects maxBatchSize", () => {
    const exporter = createBrowserTelemetryExporter({
      publicKey: "gw_pub_test_123",
      endpoint: "http://localhost:3000/api/v1/ingest/events",
      maxBatchSize: 3,
      batchIntervalMs: 10000,
    });

    exporter.emitEvent({
      type: "CLIENT_DATA_RENDERED",
      toolId: "crm_01",
      channel: "HTTP",
      timestamp: new Date().toISOString(),
    });

    // Cleanup timer to avoid dangling handles
    exporter.destroy();
    assert.ok(exporter);
  });
});
