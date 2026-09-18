import { z } from "zod";
import {
  createIsolatedTool,
  dto,
  DtoValidationError,
  PiiLeakError,
  ToolExecutionContext,
} from "../../src/agent";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runDtoPatternTests() {
  console.log("🧩 Testing avantgate/agent DTO Pattern & Helpers...\n");

  // 1. dto.boolean() helper
  const taskMutationTool = createIsolatedTool({
    name: "create_task",
    description: "Create a task",
    parameters: z.object({ title: z.string() }),
    async execute(args) {
      return { taskId: "task-123", title: args.title, internalNotes: "secret note" };
    },
    llmDto: dto.boolean(),
  });

  const taskRes = await taskMutationTool.execute({ title: "Call client" });
  assert(
    taskRes.success === true && taskRes.taskId === undefined && taskRes.internalNotes === undefined,
    "dto.boolean() produces clean { success: true } without leaking internal fields"
  );

  // 1b. dto.boolean() preserving explicit false
  const failedMutationTool = createIsolatedTool({
    name: "fail_task",
    description: "Fail a task",
    parameters: z.object({}),
    async execute() {
      return { success: false, reason: "DB error" };
    },
    llmDto: dto.boolean(),
  });
  const failedRes = await failedMutationTool.execute({});
  assert(failedRes.success === false, "dto.boolean() preserves explicit { success: false }");

  // 2. dto.booleanWithId() helper
  const taskWithIdTool = createIsolatedTool({
    name: "create_task_with_id",
    description: "Create a task returning opaque ID",
    parameters: z.object({ title: z.string() }),
    async execute() {
      return { taskId: "tsk_999", piiContact: "boss@secret.fr" };
    },
    llmDto: dto.booleanWithId("taskId"),
  });

  const taskWithIdRes = await taskWithIdTool.execute({ title: "Setup CRM" });
  assert(
    taskWithIdRes.success === true && taskWithIdRes.taskId === "tsk_999",
    "dto.booleanWithId() returns success and opaque identifier"
  );
  assert(
    taskWithIdRes.piiContact === undefined,
    "dto.booleanWithId() does not leak other server properties"
  );

  // 3. dto.count() helper
  const listProspectsTool = createIsolatedTool({
    name: "list_prospects",
    description: "List prospects count",
    parameters: z.object({}),
    async execute() {
      return {
        items: [
          { name: "John", email: "john@acme.com" },
          { name: "Jane", email: "jane@acme.com" },
          { name: "Jack", email: "jack@acme.com" },
        ],
      };
    },
    llmDto: dto.count("items"),
  });

  const countRes = await listProspectsTool.execute({});
  assert(
    countRes.success === true && countRes.count === 3 && countRes.items === undefined,
    "dto.count('items') extracts list length without leaking raw array items"
  );

  // 3b. dto.count() on root array
  const rootListTool = createIsolatedTool({
    name: "root_list",
    description: "Root array count",
    parameters: z.object({}),
    async execute() {
      return [1, 2, 3, 4, 5];
    },
    llmDto: dto.count(),
  });
  const rootCountRes = await rootListTool.execute({});
  assert(
    rootCountRes.success === true && rootCountRes.count === 5,
    "dto.count() extracts root array length"
  );

  // 4. dto.pick() helper
  const prospectDetailsTool = createIsolatedTool({
    name: "get_prospect_summary",
    description: "Get prospect summary",
    parameters: z.object({ id: z.string() }),
    async execute() {
      return {
        id: "p-42",
        status: "QUALIFIED",
        annualRevenue: 500000,
        privateApiKey: "sk_live_secret",
        clientPhone: "06 12 34 56 78",
      };
    },
    llmDto: dto.pick(["id", "status", "annualRevenue"]),
  });

  const pickedRes = await prospectDetailsTool.execute({ id: "p-42" });
  assert(
    pickedRes.id === "p-42" &&
      pickedRes.status === "QUALIFIED" &&
      pickedRes.annualRevenue === 500000,
    "dto.pick() extracts allowed whitelist fields"
  );
  assert(
    pickedRes.privateApiKey === undefined && pickedRes.clientPhone === undefined,
    "dto.pick() discards unauthorized or private fields"
  );

  // 5. Custom Functional DTO with args and context access
  let capturedContextWorkflowId: string | undefined;
  const customDtoTool = createIsolatedTool({
    name: "check_availability",
    description: "Check availability with custom DTO",
    parameters: z.object({ limit: z.number() }),
    async execute(args) {
      return [
        { slotId: "s1", start: "2026-10-01T10:00:00Z", internalTechId: 101 },
        { slotId: "s2", start: "2026-10-01T14:00:00Z", internalTechId: 102 },
      ];
    },
    llmDto: (slots, args, context) => {
      capturedContextWorkflowId = context?.workflowId;
      return {
        requestedLimit: args.limit,
        hasAvailableSlots: slots.length > 0,
        nextSlot: slots[0]?.start ?? null,
        totalSlotsFound: slots.length,
        slots: slots.map((s) => s.start),
      };
    },
  });

  const customContext: ToolExecutionContext = {
    workflowId: "wf-meeting-booking-777",
  };
  const customDtoRes = await customDtoTool.execute({ limit: 5 }, customContext);
  assert(
    capturedContextWorkflowId === "wf-meeting-booking-777",
    "Custom llmDto mapper receives context successfully"
  );
  assert(
    customDtoRes.hasAvailableSlots === true &&
      customDtoRes.totalSlotsFound === 2 &&
      customDtoRes.slots.length === 2 &&
      customDtoRes.requestedLimit === 5,
    "Custom llmDto mapper projects expected aggregate structure"
  );

  // 6. Modern clientDto alias & dual-channel
  let clientIntercepted: any = null;
  const dualChannelTool = createIsolatedTool({
    name: "update_deal",
    description: "Update deal with clientDto",
    parameters: z.object({ dealId: z.string() }),
    async execute(args) {
      return {
        dealId: args.dealId,
        fullDealPayload: { budget: 100000, margin: 0.35, clientContact: "vip@corp.com" },
      };
    },
    clientDto(data) {
      clientIntercepted = data;
    },
    llmDto: dto.booleanWithId("dealId"),
  });

  const dualRes = await dualChannelTool.execute({ dealId: "deal-888" });
  assert(
    clientIntercepted !== null && clientIntercepted.fullDealPayload.budget === 100000,
    "clientDto receives full raw data out-of-band"
  );
  assert(
    dualRes.success === true && dualRes.dealId === "deal-888" && dualRes.fullDealPayload === undefined,
    "llmDto receives isolated minimal acknowledgment"
  );

  // 7. Default passthrough when llmDto is omitted
  let directClientIntercepted: any = null;
  const directTool = createIsolatedTool({
    name: "direct_tool",
    description: "Direct configuration without custom llmDto",
    parameters: z.object({ q: z.string() }),
    async execute() {
      return { raw: "value", count: 42 };
    },
    clientDto(data) {
      directClientIntercepted = data;
    },
  });

  const directRes = await directTool.execute({ q: "test" });
  assert(directClientIntercepted?.raw === "value", "clientDto receives data when llmDto is omitted");
  assert(directRes.count === 42, "Direct execution passes payload through when llmDto is omitted");

  // 8. llmDtoSchema validation - Success Case
  const schemaValidTool = createIsolatedTool({
    name: "validated_tool",
    description: "Validated tool",
    parameters: z.object({}),
    async execute() {
      return { status: "OK", code: 200 };
    },
    llmDtoSchema: z.object({
      status: z.enum(["OK", "ERROR"]),
      code: z.number(),
    }),
    llmDto: (res) => ({ status: res.status, code: res.code }),
  });

  const validRes = await schemaValidTool.execute({});
  assert(validRes.status === "OK" && validRes.code === 200, "llmDto matching schema passes validation");

  // 9. llmDtoSchema validation - Failure Case throws DtoValidationError
  const schemaInvalidTool = createIsolatedTool({
    name: "invalid_dto_tool",
    description: "Invalid DTO tool",
    parameters: z.object({}),
    async execute() {
      return { leakedInternalId: "secret-abc" };
    },
    llmDtoSchema: z.object({
      success: z.boolean(),
      authorizedCode: z.string(),
    }),
    // Produces payload missing 'success' and 'authorizedCode'
    llmDto: (res) => ({ leakedInternalId: res.leakedInternalId } as any),
  });

  let schemaErrorCaught = false;
  let caughtToolName = "";
  try {
    await schemaInvalidTool.execute({});
  } catch (err) {
    if (err instanceof DtoValidationError) {
      schemaErrorCaught = true;
      caughtToolName = err.toolName;
    }
  }
  assert(schemaErrorCaught, "DtoValidationError is thrown when LLM DTO violates llmDtoSchema");
  assert(caughtToolName === "invalid_dto_tool", "DtoValidationError records accurate toolName");

  // 10. In-flight PII redaction applies to LLM DTO
  const piiInDtoTool = createIsolatedTool({
    name: "pii_dto_tool",
    description: "PII in DTO tool",
    parameters: z.object({}),
    async execute() {
      return { note: "Please email contact@secretcorp.fr for assistance" };
    },
    llmDto: (res) => ({ summaryNote: res.note }),
  });

  const piiDtoRes = (await piiInDtoTool.execute({})) as { summaryNote: string };
  assert(
    piiDtoRes.summaryNote.includes("[REDACTED_EMAIL]"),
    "In-flight PII masking applies seamlessly onto LLM DTO output"
  );

  console.log("\n🎉 All DTO Pattern & Helpers tests passed successfully!");
}

runDtoPatternTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
