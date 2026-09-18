import { z } from "zod";
import {
  createIsolatedTool,
  PiiLeakError,
  auditToolResult,
} from "../../src/agent";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runIsolatedToolTests() {
  console.log("🛡️ Testing avantgate/agent Isolated Tool & Dual-Channel...\n");

  // Test 1: Dual-Channel mechanism
  let interceptedClientData: any = null;

  const searchProspectsTool = createIsolatedTool({
    name: "search_prospects",
    description: "Search corporate prospects",
    parameters: z.object({ query: z.string() }),
    async execute(args) {
      return {
        query: args.query,
        count: 2,
        prospects: [
          { name: "Alice Dupont", email: "alice@company.fr", phone: "06 12 34 56 78" },
          { name: "Bob Martin", email: "bob@finance.com", phone: "+33 1 45 67 89 00" },
        ],
      };
    },
    clientDto(data) {
      interceptedClientData = data;
    },
    llmDto(data) {
      return {
        found: data.count,
        summary: `Found ${data.count} prospects matching criteria. Details sent directly to user UI.`,
      };
    },
  });

  const llmResult = await searchProspectsTool.execute({ query: "Fintech" });

  assert(
    interceptedClientData !== null && interceptedClientData.prospects.length === 2,
    "Out-of-band client callback received full raw prospect list"
  );
  assert(
    llmResult.found === 2,
    "LLM received expected summary count"
  );
  assert(
    !JSON.stringify(llmResult).includes("alice@company.fr"),
    "LLM response contains no raw email PII"
  );

  // Test 2: In-flight PII redaction on LLM summary
  const riskySummaryTool = createIsolatedTool({
    name: "user_lookup",
    description: "Lookup user contact",
    parameters: z.object({ id: z.string() }),
    async execute() {
      return {
        message: "Contact CEO at ceo@secret.com or 06 99 88 77 66 for details",
      };
    },
    // No custom summary, payload passes directly
  });

  const sanitizedLlmResult = (await riskySummaryTool.execute({ id: "1" })) as {
    message: string;
  };
  assert(
    sanitizedLlmResult.message.includes("[REDACTED_EMAIL]"),
    "In-flight PII guard masked email in LLM payload"
  );
  assert(
    sanitizedLlmResult.message.includes("[REDACTED_PHONE]"),
    "In-flight PII guard masked phone in LLM payload"
  );

  // Test 3: throwOnPii strict mode
  const strictTool = createIsolatedTool({
    name: "strict_export",
    description: "Export internal notes",
    parameters: z.object({}),
    throwOnPii: true,
    async execute() {
      return { note: "Draft contract sent to legal@enterprise.fr" };
    },
  });

  let leakCaught = false;
  try {
    await strictTool.execute({});
  } catch (err) {
    if (err instanceof PiiLeakError) {
      leakCaught = true;
    }
  }
  assert(leakCaught, "PiiLeakError is raised when throwOnPii is active");

  // Test 4: auditToolResult direct helper
  const auditRes = auditToolResult(
    { deep: { ssn: "1 85 12 75 108 123 45", regular: "Hello" } },
    { toolName: "audit_test" }
  );
  assert(auditRes.maskedCount === 1, "auditToolResult detected 1 French SSN/NIR");
  assert(
    (auditRes.sanitizedData as any).deep.ssn === "[REDACTED_NIR]",
    "NIR was properly redacted in deep object"
  );

  console.log("\n🎉 All IsolatedTool tests passed successfully!");
}

runIsolatedToolTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
