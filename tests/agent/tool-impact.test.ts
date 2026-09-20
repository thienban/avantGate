import {
  createIsolatedTool,
  ToolRegistry,
  ReadOnlyToolStrategy,
  MaxImpactToolStrategy,
  AccessControlToolStrategy,
} from "../../src/agent";
import { z } from "zod";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runToolImpactTests() {
  console.log("🛡️ Testing avantgate/agent Tool Impact & Side-Effects Governance (DESIGN-015)...\n");

  // 1. Safe Defaults & Inference
  const readTool = createIsolatedTool({
    name: "get_user",
    description: "Get user details",
    parameters: z.object({ id: z.string() }),
    async execute() {
      return { id: "1" };
    },
  });
  assert(readTool._impact === "READ_ONLY", "Default impact is READ_ONLY when omitted");
  assert(readTool._requireApproval === false, "Default requireApproval is false for READ_ONLY");

  // 2. Safe-by-default for DESTRUCTIVE tools (auto-activates requireApproval)
  const deleteTool = createIsolatedTool({
    name: "purge_database",
    description: "Purge all records",
    impact: "DESTRUCTIVE",
    parameters: z.object({}),
    async execute() {
      return { success: true };
    },
  });
  assert(deleteTool._impact === "DESTRUCTIVE", "Tool has impact DESTRUCTIVE");
  assert(deleteTool._requireApproval === true, "DESTRUCTIVE tool automatically sets requireApproval: true");

  // 3. Explicit requireApproval: false on DESTRUCTIVE is respected
  const autoCleanupTool = createIsolatedTool({
    name: "clear_temp_cache",
    description: "Clear temporary scratch files",
    impact: "DESTRUCTIVE",
    requireApproval: false,
    parameters: z.object({}),
    async execute() {
      return { cleaned: true };
    },
  });
  assert(autoCleanupTool._requireApproval === false, "Explicit requireApproval: false is preserved on DESTRUCTIVE");

  // 4. Mutative Tool
  const updateTool = createIsolatedTool({
    name: "update_profile",
    description: "Update user profile",
    impact: "MUTATIVE",
    parameters: z.object({ name: z.string() }),
    async execute() {
      return { updated: true };
    },
  });
  assert(updateTool._impact === "MUTATIVE", "Tool has impact MUTATIVE");
  assert(updateTool._requireApproval === false, "MUTATIVE tool defaults requireApproval to false");

  // 5. ToolRegistry integration & getByImpact
  const registry = new ToolRegistry();
  registry.registerMany([readTool, updateTool, deleteTool, autoCleanupTool]);

  const readOnlyTools = registry.getByImpact("READ_ONLY");
  assert(readOnlyTools.length === 1, "getByImpact('READ_ONLY') returned 1 tool");
  assert(readOnlyTools[0].name === "get_user", "Correct READ_ONLY tool returned");

  const mutativeTools = registry.getByImpact("MUTATIVE");
  assert(mutativeTools.length === 1, "getByImpact('MUTATIVE') returned 1 tool");
  assert(mutativeTools[0].name === "update_profile", "Correct MUTATIVE tool returned");

  const destructiveTools = registry.getByImpact("DESTRUCTIVE");
  assert(destructiveTools.length === 2, "getByImpact('DESTRUCTIVE') returned 2 tools");

  // 6. getDescriptors with impact filter
  const descriptors = registry.getDescriptors({ impact: "DESTRUCTIVE" });
  assert(descriptors.length === 2, "getDescriptors({ impact: 'DESTRUCTIVE' }) returned 2 descriptors");
  assert(descriptors.every((d) => d.impact === "DESTRUCTIVE"), "All descriptors have impact DESTRUCTIVE");

  // 7. ReadOnlyToolStrategy
  const readOnlyStrategy = new ReadOnlyToolStrategy();
  const allTools = registry.getAll();
  const criticTools = readOnlyStrategy.selectTools(allTools, {});
  assert(criticTools.length === 1, "ReadOnlyToolStrategy selected exactly 1 tool");
  assert(criticTools[0].name === "get_user", "Inspection/Auditor agent receives only get_user");

  // 8. MaxImpactToolStrategy
  const maxReadStrategy = new MaxImpactToolStrategy("READ_ONLY");
  const readCapped = maxReadStrategy.selectTools(allTools, {});
  assert(readCapped.length === 1, "MaxImpactToolStrategy('READ_ONLY') returns 1 tool");

  const maxMutativeStrategy = new MaxImpactToolStrategy("MUTATIVE");
  const mutativeCapped = maxMutativeStrategy.selectTools(allTools, {});
  assert(mutativeCapped.length === 2, "MaxImpactToolStrategy('MUTATIVE') returns READ_ONLY and MUTATIVE tools (2 tools)");
  assert(
    mutativeCapped.every((t) => t.impact === "READ_ONLY" || t.impact === "MUTATIVE"),
    "No DESTRUCTIVE tools passed through MaxImpactToolStrategy('MUTATIVE')"
  );

  const maxDestructiveStrategy = new MaxImpactToolStrategy("DESTRUCTIVE");
  const allCapped = maxDestructiveStrategy.selectTools(allTools, {});
  assert(allCapped.length === 4, "MaxImpactToolStrategy('DESTRUCTIVE') allows all 4 tools");

  // 9. AccessControlToolStrategy with maxImpact option
  const safeAccessStrategy = new AccessControlToolStrategy({
    maxImpact: "MUTATIVE",
  });
  const safeAccessSelected = safeAccessStrategy.selectTools(allTools, {});
  assert(safeAccessSelected.length === 2, "AccessControlToolStrategy respects maxImpact option");

  console.log("\n🎉 All Tool Impact & Side-Effects Governance tests passed successfully!");
}

runToolImpactTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
