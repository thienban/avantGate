import { z } from "zod";
import {
  AccessControlToolStrategy,
  RoleBasedToolStrategy,
  ToolRegistry,
  createIsolatedTool,
  ToolAccessDeniedError,
} from "../../src/agent";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runToolGovernanceTests() {
  console.log("🛡️ Testing avantgate/agent Tool Governance, Domains & Access Control...\n");

  // 1. Declarative Metadata on Isolated Tools
  const createLeadTool = createIsolatedTool({
    name: "create_lead",
    domain: "crm",
    resource: "prospects",
    roles: ["SALES", "ADMIN"],
    impact: "MUTATIVE",
    requireApproval: false,
    parameters: z.object({ email: z.string(), name: z.string() }),
    invalidationTags: ["crm:prospects"],
    async execute(args) {
      return { id: "lead-123", email: args.email, name: args.name };
    },
  });

  assert(createLeadTool._domain === "crm", "createLeadTool has _domain crm");
  assert(createLeadTool._resource === "prospects", "createLeadTool has _resource prospects");
  assert(
    createLeadTool._roles?.includes("SALES") && createLeadTool._roles?.includes("ADMIN"),
    "createLeadTool has roles SALES and ADMIN"
  );
  assert(createLeadTool._impact === "MUTATIVE", "createLeadTool has impact MUTATIVE");
  assert(createLeadTool._requireApproval === false, "createLeadTool has _requireApproval false");

  // 2. DataAccessGuard & ToolAccessDeniedError (anti-IDOR)
  const deleteLeadTool = createIsolatedTool({
    name: "delete_lead",
    domain: "crm",
    resource: "prospects",
    roles: ["ADMIN"],
    impact: "DESTRUCTIVE",
    requireApproval: true,
    parameters: z.object({ leadId: z.string(), ownerTenantId: z.string() }),
    dataAccessGuard(args, context) {
      // RLS Guard: ensure target owner matches current caller's tenantId
      return args.ownerTenantId === (context?.tenantId as string);
    },
    invalidationTags(args) {
      return ["crm:prospects", `crm:prospects:${args.leadId}`];
    },
    async execute(args) {
      return { deleted: true, leadId: args.leadId };
    },
  });

  // Test Guard Failure (IDOR attempt)
  let deniedCaught = false;
  try {
    await deleteLeadTool.execute(
      { leadId: "lead-999", ownerTenantId: "tenant-victim" },
      { tenantId: "tenant-attacker" }
    );
  } catch (err) {
    if (err instanceof ToolAccessDeniedError) {
      deniedCaught = true;
      assert(
        err.toolName === "delete_lead",
        "ToolAccessDeniedError contains accurate tool name"
      );
      assert(
        err.message.includes("Access denied for tool"),
        "ToolAccessDeniedError formats descriptive message"
      );
    }
  }
  assert(deniedCaught, "dataAccessGuard intercepted unauthorized IDOR mutation");

  // Test Guard Success & InvalidationTags resolution
  let emittedTags: string[] = [];
  const validExecResult = await deleteLeadTool.execute(
    { leadId: "lead-123", ownerTenantId: "tenant-valid" },
    {
      tenantId: "tenant-valid",
      async onInvalidationTags(tags) {
        emittedTags = tags;
      },
    }
  );

  assert(validExecResult.deleted === true, "Authorized execution succeeded");
  assert(
    deleteLeadTool._lastInvalidationTags?.includes("crm:prospects:lead-123"),
    "Dynamic invalidationTags recorded on tool instance"
  );
  assert(
    emittedTags.includes("crm:prospects") && emittedTags.includes("crm:prospects:lead-123"),
    "Dynamic invalidationTags dispatched to context.onInvalidationTags"
  );

  // 3. Registry batch registration (registerMany), domain filtering & getDescriptors
  const calendarEventTool = createIsolatedTool({
    name: "schedule_meeting",
    domain: "calendar",
    resource: "events",
    roles: ["SALES", "SUPPORT"],
    impact: "MUTATIVE",
    parameters: z.object({ title: z.string() }),
    async execute(args) {
      return { eventId: "ev-1", title: args.title };
    },
  });

  const billingInvoiceTool = createIsolatedTool({
    name: "generate_invoice",
    domain: "billing",
    resource: "invoices",
    roles: ["ADMIN", "ACCOUNTANT"],
    impact: "DESTRUCTIVE",
    parameters: z.object({ amount: z.number() }),
    async execute(args) {
      return { invoiceId: "inv-1", amount: args.amount };
    },
  });

  const registry = new ToolRegistry();
  registry.registerMany([createLeadTool, deleteLeadTool, calendarEventTool, billingInvoiceTool]);

  assert(registry.getAll().length === 4, "registerMany registered all 4 tools");

  // getByDomain
  const crmTools = registry.getByDomain("crm");
  assert(crmTools.length === 2, "getByDomain('crm') returned 2 tools");
  assert(
    crmTools.every((t) => t.domain === "crm"),
    "All tools from getByDomain have domain 'crm'"
  );

  const billingTools = registry.getByDomain("billing");
  assert(billingTools.length === 1, "getByDomain('billing') returned 1 tool");
  assert(billingTools[0].name === "generate_invoice", "Correct billing tool retrieved");

  // toRecord with domain filter
  const crmRecord = registry.toRecord({ domain: "crm" });
  assert(Object.keys(crmRecord).length === 2, "toRecord({ domain: 'crm' }) has 2 keys");
  assert("create_lead" in crmRecord && "delete_lead" in crmRecord, "CRM record contains expected tool keys");
  assert(!("schedule_meeting" in crmRecord), "Non-CRM tools are filtered out of crmRecord");

  // getDescriptors
  const descriptors = registry.getDescriptors();
  assert(descriptors.length === 4, "getDescriptors() exports 4 descriptors");
  assert(descriptors[0].id === "create_lead", "Descriptor has correct tool id");
  assert(descriptors[0].domain === "crm", "Descriptor exports domain metadata");
  assert(descriptors[0].resource === "prospects", "Descriptor exports resource metadata");
  assert(descriptors[0].impact === "MUTATIVE", "Descriptor exports impact metadata");

  const adminDescriptors = registry.getDescriptors({ role: "ADMIN" });
  assert(
    adminDescriptors.length === 3,
    "getDescriptors({ role: 'ADMIN' }) filters tools accessible to ADMIN"
  );

  const crmDescriptors = registry.getDescriptors({ domain: "crm" });
  assert(
    crmDescriptors.length === 2,
    "getDescriptors({ domain: 'crm' }) returns only CRM descriptors"
  );

  // 4. AccessControlToolStrategy
  const allRegistered = registry.getAll();

  // Scenario A: Sales user in CRM domain
  const salesCrmStrategy = new AccessControlToolStrategy({
    allowedDomains: ["crm"],
  });
  const salesSelected = salesCrmStrategy.selectTools(allRegistered, {
    role: "SALES",
  });
  assert(salesSelected.length === 1, "Sales user only matches 1 CRM tool (create_lead)");
  assert(salesSelected[0].name === "create_lead", "Sales user selected create_lead");

  // Scenario B: Admin user in CRM domain matches both
  const adminSelected = salesCrmStrategy.selectTools(allRegistered, {
    role: "ADMIN",
  });
  assert(adminSelected.length === 2, "Admin user matches 2 CRM tools");

  // Scenario C: Multi-domain access (CRM + Calendar)
  const multiDomainStrategy = new AccessControlToolStrategy({
    allowedDomains: ["crm", "calendar"],
  });
  const multiDomainSelected = multiDomainStrategy.selectTools(allRegistered, {
    role: "SALES",
  });
  assert(multiDomainSelected.length === 2, "Multi-domain strategy selected create_lead and schedule_meeting");

  // Scenario D: Impact capping with maxImpact: MUTATIVE (filters out DESTRUCTIVE tools)
  const safeAdminStrategy = new AccessControlToolStrategy({
    allowedDomains: ["crm"],
    maxImpact: "MUTATIVE",
  });
  const safeAdminSelected = safeAdminStrategy.selectTools(allRegistered, {
    role: "ADMIN",
  });
  assert(safeAdminSelected.length === 1, "maxImpact: MUTATIVE filtered out DESTRUCTIVE delete_lead for Admin");
  assert(safeAdminSelected[0].name === "create_lead", "Only non-destructive create_lead permitted");

  // 5. Backward Compatibility with RoleBasedToolStrategy
  const legacyRoleStrategy = new RoleBasedToolStrategy();
  const legacySelected = legacyRoleStrategy.selectTools(allRegistered, {
    role: "ACCOUNTANT",
  });
  assert(legacySelected.length === 1, "Legacy RoleBasedToolStrategy works with tool.roles");
  assert(legacySelected[0].name === "generate_invoice", "ACCOUNTANT matched generate_invoice");

  console.log("\n🎉 All Tool Governance & Domains tests passed successfully!");
}

runToolGovernanceTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
