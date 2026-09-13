import { z } from "zod";
import {
  AgentToolFactory,
  ToolRegistry,
  PhaseBasedToolStrategy,
  RoleBasedToolStrategy,
  CompositeToolStrategy,
  applyToolStrategy,
  createIsolatedTool,
} from "../../src/agent";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runToolPatternsTests() {
  console.log("🧩 Testing avantgate/agent Factory, Registry & Strategies...\n");

  // Test 1: AgentToolFactory context injection
  const factory = new AgentToolFactory({
    userId: "usr-42",
    tenantId: "org-acme",
    role: "ADMIN",
  });

  const boundTool = factory.createTool((context) => ({
    name: "fetch_billing",
    description: "Fetch tenant billing info",
    parameters: z.object({ year: z.number() }),
    async execute(args) {
      return {
        tenant: context.tenantId,
        user: context.userId,
        year: args.year,
        balance: 1250,
      };
    },
  }));

  const billingRes = await boundTool.execute({ year: 2026 });
  assert(billingRes.tenant === "org-acme", "Factory injected tenantId into tool context");
  assert(billingRes.user === "usr-42", "Factory injected userId into tool context");

  // Test 2: ToolRegistry and RBAC / Phase filtering
  const dummyTool = createIsolatedTool({
    name: "dummy",
    description: "dummy tool",
    parameters: z.object({}),
    async execute() {
      return { ok: true };
    },
  });

  const registry = new ToolRegistry();
  registry.register({
    name: "qualify_lead",
    description: "Lead qualification",
    phases: ["discovery", "qualification"],
    requiredRoles: ["SALES", "ADMIN"],
    tool: dummyTool,
  });
  registry.register({
    name: "send_quote",
    description: "Send official pricing quote",
    phases: ["closing"],
    requiredRoles: ["SALES_DIRECTOR", "ADMIN"],
    tool: dummyTool,
  });
  registry.register({
    name: "delete_account",
    description: "Delete tenant account",
    phases: ["admin"],
    requiredRoles: ["SUPER_ADMIN"],
    tool: dummyTool,
  });

  const discoveryTools = registry.getByPhase("discovery");
  assert(discoveryTools.length === 1, "Only qualify_lead matches discovery phase");
  assert(discoveryTools[0].name === "qualify_lead", "Matches correct tool name");

  const salesTools = registry.filterByRoles(["SALES"]);
  assert(salesTools.length === 1, "Only qualify_lead is accessible to SALES role");

  // Test 3: Dynamic Strategy Selection
  const phaseStrategy = new PhaseBasedToolStrategy();
  const roleStrategy = new RoleBasedToolStrategy();
  const compositeStrategy = new CompositeToolStrategy([phaseStrategy, roleStrategy]);

  const allTools = registry.getAll();

  // Case A: Sales in closing phase -> can NOT access send_quote because role is not SALES_DIRECTOR
  const toolsForSalesInClosing = await compositeStrategy.selectTools(allTools, {
    phase: "closing",
    role: "SALES",
  });
  assert(toolsForSalesInClosing.length === 0, "Sales user cannot access closing quote tool");

  // Case B: Admin in closing phase -> CAN access send_quote
  const toolsForAdminInClosing = await compositeStrategy.selectTools(allTools, {
    phase: "closing",
    role: "ADMIN",
  });
  assert(toolsForAdminInClosing.length === 1, "Admin user can access closing quote tool");
  assert(toolsForAdminInClosing[0].name === "send_quote", "Correct closing tool selected");

  // Test 4: applyToolStrategy converts directly to Vercel AI SDK tools dictionary
  const aiSdkTools = await applyToolStrategy(allTools, compositeStrategy, {
    phase: "closing",
    role: "ADMIN",
  });
  assert(Boolean(aiSdkTools["send_quote"]), "aiSdkTools record contains send_quote key");
  assert(typeof aiSdkTools["send_quote"].execute === "function", "Tool has execute method");

  console.log("\n🎉 All Tool Patterns tests passed successfully!");
}

runToolPatternsTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
