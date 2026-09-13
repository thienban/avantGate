import { z } from "zod";
import {
  createIsolatedTool,
  ToolRegistry,
} from "../../src/agent";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runToolAliasingTests() {
  console.log("🏷️ Testing avantgate/agent Tool ID & Aliasing...\n");

  // Test 1: Tool with explicit ID and Alias
  const sapTool = createIsolatedTool({
    id: "sap_erp_payroll_01",
    name: "internal_sap_payroll_v2",
    alias: "lookup_payroll",
    description: "Lookup corporate payroll data",
    parameters: z.object({ employeeId: z.string() }),
    async execute(args) {
      return { employeeId: args.employeeId, salary: 50000 };
    },
  });

  assert(sapTool._toolId === "sap_erp_payroll_01", "Tool preserves explicit immutable ID");
  assert(sapTool._toolName === "internal_sap_payroll_v2", "Tool preserves internal technical name");
  assert(sapTool._toolAlias === "lookup_payroll", "Tool preserves public alias");

  // Test 2: Rétrocompatibilité (id omis -> id = name)
  const legacyTool = createIsolatedTool({
    name: "legacy_calculator",
    description: "Simple calculation",
    parameters: z.object({ num: z.number() }),
    async execute(args) {
      return { doubled: args.num * 2 };
    },
  });

  assert(
    legacyTool._toolId === "legacy_calculator",
    "Fallback: toolId defaults to name when id is omitted (no breaking change)"
  );

  // Test 3: ToolRegistry double indexation O(1)
  const registry = new ToolRegistry();
  registry.register({
    id: sapTool._toolId,
    name: sapTool._toolName,
    alias: sapTool._toolAlias,
    description: sapTool.description,
    tool: sapTool,
  });

  const byId = registry.getById("sap_erp_payroll_01");
  assert(byId !== undefined, "Registry retrieves tool by technical ID in O(1)");
  assert(byId?.name === "internal_sap_payroll_v2", "Correct tool retrieved by ID");

  const byAlias = registry.getByPublicName("lookup_payroll");
  assert(byAlias !== undefined, "Registry retrieves tool by public alias in O(1)");
  assert(byAlias?.id === "sap_erp_payroll_01", "Correct tool retrieved by alias");

  const byGeneric = registry.get("lookup_payroll");
  assert(byGeneric?.id === "sap_erp_payroll_01", "Registry get() resolves public alias");

  // Test 4: toRecord with anonymization
  const anonymizedRecord = registry.toRecord({ anonymize: true });
  assert(Boolean(anonymizedRecord["lookup_payroll"]), "anonymized record uses public alias as key");
  assert(!anonymizedRecord["internal_sap_payroll_v2"], "internal technical name is NOT leaked in record keys");

  const technicalRecord = registry.toRecord({ anonymize: false });
  assert(Boolean(technicalRecord["internal_sap_payroll_v2"]), "non-anonymized record uses internal technical name");

  console.log("\n🎉 All Tool Aliasing tests passed successfully!");
}

runToolAliasingTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
