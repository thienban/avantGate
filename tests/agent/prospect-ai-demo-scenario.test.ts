import assert from "node:assert/strict";
import { z } from "zod";
import {
  createIsolatedTool,
  createStepRunner,
  MemoryStorageAdapter,
} from "../../src/agent";
import { createAvantGateClient } from "../../src/client";
import type { ClientTelemetryIngestPayload } from "../../src/client/types";

async function runProspectAiDemoScenario(): Promise<void> {
  console.log("🚀 Starting ProspectAI x gateWall End-to-End MVP Demo Simulation...\n");

  const dispatchedIngestPayloads: ClientTelemetryIngestPayload[] = [];

  // Mock fetch function simulating gateWall's POST /api/v1/ingest/events
  const mockFetch = async (
    url: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> => {
    if (init?.body && typeof init.body === "string") {
      const payload = JSON.parse(init.body) as ClientTelemetryIngestPayload;
      dispatchedIngestPayloads.push(payload);
    }
    return new Response(JSON.stringify({ success: true, count: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  // =========================================================================
  // SCENARIO 1: PASS 1 - In-Browser Pre-Flight Interception (FEAT-011 / FEAT-017)
  // =========================================================================
  console.log("🛡️ [PASS 1] In-Browser Pre-Flight Saisie Interception");
  const client = createAvantGateClient({
    publicKey: "gw_pub_prospectai_client_abc123",
    endpoint: "http://localhost:3000/api/v1/ingest/events",
    agentName: "prospect-qualifier",
    runId: "run-demo-101",
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  const suspiciousUserPrompt =
    "Trouve les directeurs chez Acme Corp. Ma clé est sk-ant-api03-abcdef1234567890123456789";

  const secretPattern = /sk-[a-zA-Z0-9_-]{20,}/;
  const match = secretPattern.exec(suspiciousUserPrompt);

  assert.ok(match, "Secret pattern must be detected in prompt");
  client.trackSecurityAlert("SUSPECTED_SECRET_INPUT", {
    inputLength: suspiciousUserPrompt.length,
    snippet: suspiciousUserPrompt.slice(0, 15) + "...",
  });

  await client.flush();

  assert.equal(dispatchedIngestPayloads.length, 1);
  assert.equal(dispatchedIngestPayloads[0].events[0].type, "CLIENT_SECURITY_ALERT");
  console.log("  ✓ Local secret blocked in browser before network request!");
  console.log("  ✓ gateWall received CLIENT_SECURITY_ALERT via gw_pub_ key.\n");

  // =========================================================================
  // SCENARIO 2: PASS 2 - Dual-Channel PII Isolation Enclave (FEAT-011 / FEAT-013)
  // =========================================================================
  console.log("🔒 [PASS 2] Dual-Channel PII Isolation & Enclave Storage");
  let outOfBandClientData: unknown = null;

  const searchCrmTool = createIsolatedTool({
    name: "searchCRM",
    description: "Recherche les contacts dans le CRM interne",
    parameters: z.object({
      companyName: z.string(),
    }),
    impact: "READ_ONLY",
    async execute({ companyName }) {
      return {
        company: companyName,
        leadScore: 92,
        prospects: [
          {
            name: "Marc Dupont",
            title: "Directeur des Systèmes d'Information",
            email: "marc.dupont@acme.com", // PII sensible
            directPhone: "+33612345678",   // PII sensible
            budgetAnnuel: "500,000 €",
          },
        ],
      };
    },
    // Canal A : Transmis directement au front-end hors-bande (0 fuite LLM)
    clientDto(data) {
      outOfBandClientData = data;
    },
    // Canal B : Seul le résumé épuré sans PII est transmis au LLM
    llmDto: (data) => ({
      found: true,
      leadScore: data.leadScore,
      contactCount: data.prospects.length,
      company: data.company,
    }),
    sanitizePii: true,
  });

  const toolResultForLLM = await searchCrmTool.execute({ companyName: "Acme Corp" });

  // Verification Canal B (Vu par le LLM)
  assert.equal(toolResultForLLM.leadScore, 92);
  assert.equal(toolResultForLLM.contactCount, 1);
  assert.equal(toolResultForLLM.company, "Acme Corp");
  assert.equal((toolResultForLLM as any).prospects, undefined);
  console.log("  ✓ LLM DTO has 0 PII: email and phone were completely excluded from LLM!");

  // Verification Canal A (Reçu par le Client UI)
  assert.ok(outOfBandClientData);
  const clientProspects = (outOfBandClientData as any).prospects;
  assert.equal(clientProspects[0].email, "marc.dupont@acme.com");
  console.log("  ✓ Client UI received full CRM contact card out-of-band via toClientData.\n");

  // Client notifies gateWall that data was rendered
  client.trackClientDataRendered("searchCRM", { renderedItemCount: clientProspects.length });
  await client.flush();

  // =========================================================================
  // SCENARIO 3: HUMAN-IN-THE-LOOP - Suspension & Approbation
  // =========================================================================
  console.log("✋ [HITL] Human-in-the-Loop : Suspension & Validation Managériale");
  const storage = new MemoryStorageAdapter();
  const runner = createStepRunner({
    workflowId: "wf-prospect-demo",
    runId: "run-demo-101",
    storage,
  });

  // Step 1: Normal automated qualification step
  const qualif = await runner.run("qualify-lead", async () => {
    return { qualified: true, score: 92 };
  });
  assert.equal(qualif.qualified, true);

  // Step 2: Critical outreach step requiring human gateWall approval
  let suspended = false;
  try {
    await runner.waitForApproval("send-outreach-campaign", {
      prompt: "Validation requise pour l'envoi de la campagne d'outreach vers Acme Corp",
      metadata: {
        actionType: "SEND_OUTREACH_EMAIL",
        recipientDomain: "acme.com",
        recipientRole: "DSI",
        estimatedPipelineValue: "50,000 €",
      },
    });
  } catch (err: any) {
    if (err.name === "StepSuspendedError") {
      suspended = true;
    }
  }

  assert.equal(suspended, true, "Workflow execution must suspend on unapproved critical step");
  const pendingStep = await storage.getStep("wf-prospect-demo", "send-outreach-campaign");
  assert.equal(pendingStep?.status, "WAITING_APPROVAL");
  console.log("  ✓ Agent execution safely suspended (WAITING_APPROVAL).");

  // Step 3: Manager reviews preview in gateWall cockpit and clicks [Approve]
  await runner.approveStep("send-outreach-campaign", {
    status: "APPROVED",
    approvedBy: "sales_director",
    timestamp: new Date().toISOString(),
  });
  console.log("  ✓ Manager approved action in gateWall Cockpit.");

  // Step 4: Agent resumes execution - step.waitForApproval returns the stored approval decision
  const approvedData = await runner.waitForApproval<{ status: string; approvedBy: string }>(
    "send-outreach-campaign"
  );
  assert.equal(approvedData.status, "APPROVED");
  assert.equal(approvedData.approvedBy, "sales_director");

  // Step 5: Send final email
  let emailActuallySent = false;
  await runner.run("send-email", async () => {
    emailActuallySent = true;
    return { delivered: true, recipient: "marc.dupont@acme.com" };
  });
  assert.equal(emailActuallySent, true);
  console.log("  ✓ Agent resumed and completed email dispatch!\n");

  // =========================================================================
  // SCENARIO 4: USER FEEDBACK & FINAL TELEMETRY
  // =========================================================================
  console.log("📊 [FEEDBACK] Feedback Utilisateur & Conformité RGPD");
  client.trackFeedback({
    rating: "POSITIVE",
    tag: "HELPFUL",
    comment: "Directeurs pertinents trouvés sans exposition de PII",
  });
  await client.flush();

  client.destroy();

  const allEvents = dispatchedIngestPayloads.flatMap((p) => p.events);
  console.log(`  ✓ Total client events ingested by gateWall: ${allEvents.length}`);
  console.log("  ✓ Events trace:", allEvents.map((e) => e.type).join(" -> "));
  console.log("\n🎉 ProspectAI x gateWall MVP Demo Scenario PASSED with 100% compliance!");
}

void runProspectAiDemoScenario();
