# 🤖 AvantGate Agent Harness (`avantgate/agent`)

> **$0-Infra Durable Workflow Engine & Tool Data Isolation for TypeScript Agents**  
> State-of-the-art security, dual-channel PII isolation, and durable step orchestration without hosting Temporal, Redis, or heavy state machines.

---

## 🌟 Overview

When building autonomous agents with TypeScript (e.g. using Vercel AI SDK), two critical challenges arise in production:
1. **PII and Data Leakage to LLMs**: Tools fetching sensitive data (emails, salaries, SSNs, financial IDs) inadvertently inject raw personal information into LLM context windows, wasting tokens and violating privacy regulations.
2. **Fragile Multi-Step Workflows**: Complex business processes crash midway without persistence, or require heavy orchestration tools (Temporal, Inngest, Redis queues) that add operational burden and cloud costs.

`avantgate/agent` solves both issues in-process:
- **Dual-Channel Isolation**: Stream rich, raw payloads directly to your UI client while returning safe, minimal, PII-redacted summaries to the LLM.
- **Serverless Durable Execution**: Memoized `step.run()` and native `step.waitForApproval()` Human-in-the-Loop suspension without server locks.
- **Universal Storage Ports**: 100% pluggable. Works out of the box in memory, with any KV store (Redis), any ORM (Prisma, Drizzle, Kysely), SQLite, or custom backends.
- **Enterprise Tool Patterns**: Factory for dependency injection, Registry for tool catalogs, and Strategy for dynamic tool pruning by workflow phase or user role.

---

## 📦 Installation & Import

```bash
npm install avantgate zod
```

Subpath import:
```typescript
import {
  createIsolatedTool,
  dto,
  DtoValidationError,
  ToolAccessDeniedError,
  createStepRunner,
  createCustomStorageAdapter,
  KeyValueStorageAdapter,
  MemoryStorageAdapter,
  PrismaStorageAdapter,
  SQLiteStorageAdapter,
  AgentToolFactory,
  ToolRegistry,
  PhaseBasedToolStrategy,
  RoleBasedToolStrategy,
  AccessControlToolStrategy,
  CompositeToolStrategy,
} from "avantgate/agent";
```

---

## 🛡️ 1. Tool Data Isolation (Dual-Channel DTO & PII Shield)

Wrap your tools with `createIsolatedTool` to separate client-side rich data from LLM context using the **DTO Pattern**:

- **Client DTO (`clientDto`)**: Streams rich, unredacted data out-of-band directly to UI consumers (React components, Canvas, WebSocket).
- **LLM DTO (`llmDto`)**: Emits minimal, cognitive-optimized projections to the model, reducing token costs and preventing PII leaks.
- **DTO Validation (`llmDtoSchema`)**: Enforces strict Zod schema compliance on the generated LLM DTO at runtime.
- **Declarative Helpers (`dto.*`)**: Ready-to-use boilerplate reducers for booleans, counts, and whitelisted fields.
- **Exhaustive Projection (`dto.exhaustivePick`)**: Compile-time Type Guard preventing the "Orphan Schema" trap by enforcing explicit conscious arbitration (`keep` vs `drop`) on all source fields.

### A. Declarative Helpers (`dto`)

```typescript
import { z } from "zod";
import { createIsolatedTool, dto } from "avantgate/agent";

// 1. Mutation tools (auto-generates { success: boolean })
export const createTaskTool = createIsolatedTool({
  name: "create_task",
  description: "Create a task in CRM",
  parameters: z.object({ title: z.string() }),
  async execute(args) {
    return await db.tasks.create({ data: { title: args.title } });
  },
  llmDto: dto.boolean(),
});

// 2. Chaining with opaque ID ({ success: boolean, taskId: string })
export const createTaskWithIdTool = createIsolatedTool({
  name: "create_task_with_id",
  description: "Create a task and return its ID",
  parameters: z.object({ title: z.string() }),
  async execute(args) {
    return await db.tasks.create({ data: { title: args.title } });
  },
  llmDto: dto.booleanWithId("taskId"),
});

// 3. Counting items ({ success: true, count: number }) without leaking array elements
export const countProspectsTool = createIsolatedTool({
  name: "count_prospects",
  description: "Count total prospects",
  parameters: z.object({ filter: z.string() }),
  async execute(args) {
    return { items: await db.prospects.findMany() };
  },
  llmDto: dto.count("items"),
});

// 4. Field whitelist picking
export const getProspectSummaryTool = createIsolatedTool({
  name: "get_prospect_summary",
  description: "Get prospect summary",
  parameters: z.object({ id: z.string() }),
  async execute(args) {
    return await db.prospects.find(args.id);
  },
  llmDto: dto.pick(["id", "stage", "annualRevenue"]),
});

// 5. Exhaustive projection with compile-time drift guard (dto.exhaustivePick)
// Prevents the "Orphan Schema" trap: every source field MUST be explicitly categorized as 'keep' (LLM) or 'drop' (ignored).
// If a backend engineer adds a new field to ProspectEntity 6 months later, TypeScript refuses to compile until it is addressed.
interface ProspectEntity {
  id: string;
  stage: string;
  annualRevenue: number;
  internalRiskScore: number;
  stripeCustomerId: string;
}

export const getProspectExhaustiveTool = createIsolatedTool({
  name: "get_prospect_exhaustive",
  description: "Get prospect with compile-time drift protection",
  parameters: z.object({ id: z.string() }),
  async execute(args): Promise<ProspectEntity> {
    return await db.prospects.find(args.id);
  },
  llmDto: dto.exhaustivePick<ProspectEntity>()({
    keep: ["id", "stage", "annualRevenue"],
    drop: ["internalRiskScore", "stripeCustomerId"],
  }),
});
```


### B. Custom Functional DTO & Dual-Channel

#### 🎯 Role & Architecture: Why Dual-Channel?
In agentic workflows, an isolated tool serves two distinct consumers with opposing requirements:
1. **The Human User Interface (Client Channel)** requires full, rich, unredacted domain entities (e.g. detailed client profiles, data grids, raw timestamps, charts). Transmitting this via `clientDto` bypasses the LLM context entirely.
2. **The Large Language Model (Cognitive Channel)** only needs an actionable synthesis (e.g. *"Found 5 matching clients, 0 conflicts"*). Injecting raw database records wastes context window budget and risks leaking confidential/PII data.

#### 💡 When & Why use a Custom Functional DTO instead of `dto.exhaustivePick`?
While `dto.exhaustivePick` provides strict 1:1 compile-time field filtering on static entity records, a **Custom Functional DTO** (`llmDto: (data, args, context) => ...`) is indispensable for:
- **Cognitive Aggregation & Token Compression**: Collapsing an array of 100 entities into high-level metrics (`hasAvailableSlots: boolean`, `nextSlot: string`), saving thousands of prompt tokens.
- **Derived / Computed Properties**: Generating indicators that do not exist on the raw database entity (e.g., status flags, price conversions, diff calculations).
- **Contextual Correlation**: Computing values based on the initial query arguments (`args`) or shared workflow state (`context.state`), e.g., verifying whether returned dates match `args.requestedDate`.
- **Contract Enforcement**: Combined with `llmDtoSchema`, it guarantees runtime Zod validation of the projected payload before it reaches the model.

```typescript
export const searchClientsTool = createIsolatedTool({
  name: "search_clients",
  description: "Search corporate client database",
  parameters: z.object({ industry: z.string() }),
  async execute(args) {
    return {
      industry: args.industry,
      clients: [
        { name: "John Doe", email: "john@enterprise.com", phone: "06 12 34 56 78" },
      ],
    };
  },
  // 1. Out-of-band channel (Client UI gets full, unredacted data)
  clientDto(data) {
    uiSocket.emit("client_data", data);
  },
  // 2. LLM channel with custom projection & schema contract validation
  llmDtoSchema: z.object({
    count: z.number(),
    note: z.string(),
  }),
  llmDto: (data, args, context) => ({
    count: data.clients.length,
    note: `Found ${data.clients.length} clients in ${args.industry}. Sent to UI.`,
  }),
  sanitizePii: true, // Auto-redacts emails, phones, French NIR/SPI, IBAN/BIC
});
```

### C. 🛡️ Defense-in-Depth: Compile-Time Guards vs In-Flight Recursive DLP

Agent data protection requires a two-layered defense strategy:

| Layer | Enforcer | Target | What It Solves |
|---|---|---|---|
| **Layer 1: Structural Boundary** | `dto.exhaustivePick` (TypeScript `tsc`) | Known static entity schema & columns | Halts CI/build if backend entities drift without conscious arbitration (`keep` vs `drop`). |
| **Layer 2: Content & Blob Inspection** | In-flight DLP Scanner (`recursivelySanitize`) | Free text, `jsonb`, `Record<string, unknown>` | Catches runtime PII hidden inside unstructured text or dynamic blobs where TypeScript has no static keys. |

#### The Dynamic JSON & Metadata Gap

When an entity exposes unstructured columns (e.g. `metadata: Record<string, unknown>`, PostgreSQL `jsonb`, or MongoDB attributes), TypeScript cannot enumerate internal properties at compile-time. Furthermore, legitimate free-text columns (e.g. `agentNotes: string`) can inadvertently carry confidential client information.

AvantGate bridges this boundary by combining compile-time exhaustiveness with **deep recursive runtime inspection** (including circular reference guards):

```typescript
import { createIsolatedTool, dto } from "avantgate/agent";
import { z } from "zod";

interface SupportTicketEntity {
  id: string;
  status: string;
  internalRoutingTag: string;
  
  // ⚠️ Dynamic JSON column (TypeScript cannot inspect nested keys at compile-time)
  metadata: Record<string, unknown>; 
}

export const getTicketTool = createIsolatedTool({
  name: "get_support_ticket",
  description: "Fetch support ticket and dynamic custom metadata",
  parameters: z.object({ ticketId: z.string() }),

  async execute(args): Promise<SupportTicketEntity> {
    return {
      id: args.ticketId,
      status: "OPEN",
      internalRoutingTag: "TIER_3_INTERNAL",
      // Nested unstructured data containing emergent PII:
      metadata: {
        crmLeadId: "lead_982",
        agentNotes: "Customer requested callback at 06 12 34 56 78 or john.doe@enterprise.com",
        billingContext: {
          ibanProvided: "FR76 3000 6000 0112 3456 7890 189",
        },
      },
    };
  },

  // 🛡️ LAYER 1 (Compile-Time): Structural boundary
  // Enforces explicit arbitration on all known top-level fields of SupportTicketEntity
  llmDto: dto.exhaustivePick<SupportTicketEntity>()({
    keep: ["id", "status", "metadata"], // 'metadata' is intentionally routed to LLM
    drop: ["internalRoutingTag"],       // Stripped from LLM view
  }),

  // 🔒 LAYER 2 (Runtime Recursive DLP):
  // Recursively traverses nested objects and arrays within 'metadata'
  sanitizePii: true, // Auto-redacts emails, phones, French NIR/SPI, IBAN/BIC with [REDACTED_*]

  // Optional Strict Circuit-Breaker:
  // throwOnPii: true, // Halts execution and raises PiiLeakError if any PII token is caught
});
```

#### Payload Delivered to the LLM:

Even though `metadata` is a dynamic dictionary without static keys, AvantGate's recursive scanner deep-inspects every nested property:

```json
{
  "id": "TCK-104",
  "status": "OPEN",
  "metadata": {
    "crmLeadId": "lead_982",
    "agentNotes": "Customer requested callback at [REDACTED_PHONE] or [REDACTED_EMAIL]",
    "billingContext": {
      "ibanProvided": "[REDACTED_IBAN]"
    }
  }
}
```

---

## ⚡ 2. Durable Step Execution & Human-in-the-Loop

```typescript
import { createStepRunner, StepSuspendedError } from "avantgate/agent";

const runner = createStepRunner({
  workflowId: `wf-onboarding-${userId}`,
});

try {
  // Step 1: Idempotent execution (Memoized on subsequent calls)
  const report = await runner.run("generate-report", async () => {
    return await generateFinancialReport();
  });

  // Step 2: Human-in-the-Loop suspension
  // Halts execution cleanly by raising StepSuspendedError until human approval
  const approval = await runner.waitForApproval("wire-transfer", {
    metadata: { amount: 25000, recipient: "Supplier SAS" },
  });

  // Step 3: Executed only after approval is granted
  await runner.run("execute-transfer", async () => {
    return await executeWireTransfer(approval);
  });
} catch (error) {
  if (error instanceof StepSuspendedError) {
    console.log(`Workflow paused at step ${error.stepId} waiting for human validation.`);
  }
}
```

To approve or reject steps from an administrative API or UI webhook:
```typescript
// Approve:
await runner.approveStep("wire-transfer", { authorizedBy: "admin@corp.com" });

// Reject:
await runner.rejectStep("wire-transfer", "Exceeds daily threshold");
```

---

## 🔌 3. Universal Storage Adapters (Ports & Adapters)

Any persistence library can be plugged in without requiring third-party runtime dependencies in AvantGate:

### A. In-Memory (Zero Config / Prototyping)
```typescript
import { MemoryStorageAdapter } from "avantgate/agent";

const storage = new MemoryStorageAdapter({ ttlMs: 3600000 }); // Optional TTL
```

### B. Universal Custom Adapter (Drizzle, Kysely, Supabase, Mongo)
```typescript
import { createCustomStorageAdapter } from "avantgate/agent";

const storage = createCustomStorageAdapter({
  async getStep(workflowId, stepId) {
    return await db.query.steps.findFirst({
      where: and(eq(steps.workflowId, workflowId), eq(steps.stepId, stepId)),
    });
  },
  async saveStep(step) {
    await db.insert(steps).values(step).onConflictDoUpdate({ target: [steps.workflowId, steps.stepId], set: step });
  },
  async updateStepStatus(workflowId, stepId, status, patch) {
    await db.update(steps).set({ status, ...patch }).where(and(eq(steps.workflowId, workflowId), eq(steps.stepId, stepId)));
  },
  async listSteps(workflowId) {
    return await db.select().from(steps).where(eq(steps.workflowId, workflowId));
  },
});
```

### C. Key-Value Stores (Redis, Upstash, Cloudflare KV)
```typescript
import { KeyValueStorageAdapter } from "avantgate/agent";
import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const storage = new KeyValueStorageAdapter(redis, {
  prefix: "agent:step:",
  ttlSeconds: 86400,
});
```

### D. Prisma ORM
```typescript
import { PrismaStorageAdapter } from "avantgate/agent";
import { prisma } from "@/lib/prisma";

const storage = new PrismaStorageAdapter(prisma.stepRecord);
```

### E. SQLite
```typescript
import { SQLiteStorageAdapter } from "avantgate/agent";
import Database from "better-sqlite3";

const db = new Database("workflow.db");
const storage = new SQLiteStorageAdapter(db); // Automatically creates table avantgate_steps
```

---

## 🧩 4. Tool Patterns: Factory, Registry & Strategy

### A. Factory (Dependency & Context Injection)
```typescript
import { AgentToolFactory } from "avantgate/agent";

const factory = new AgentToolFactory({
  tenantId: "corp-1",
  userId: "user-42",
});

const tenantTool = factory.createTool((ctx) => ({
  name: "get_orders",
  description: "Get tenant orders",
  parameters: z.object({ limit: z.number() }),
  async execute(args) {
    return await fetchOrdersForTenant(ctx.tenantId, args.limit);
  },
}));
```

### B. Registry & Dynamic Selection Strategy
```typescript
import {
  ToolRegistry,
  PhaseBasedToolStrategy,
  RoleBasedToolStrategy,
  CompositeToolStrategy,
  applyToolStrategy,
} from "avantgate/agent";

const registry = new ToolRegistry();
registry.register({
  name: "qualify_prospect",
  description: "Qualify prospect",
  phases: ["discovery"],
  requiredRoles: ["SALES"],
  tool: qualifyTool,
});
registry.register({
  name: "issue_invoice",
  description: "Issue invoice",
  phases: ["closing"],
  requiredRoles: ["ADMIN"],
  tool: invoiceTool,
});

// Dynamic prune for current agent phase and user role:
const compositeStrategy = new CompositeToolStrategy([
  new PhaseBasedToolStrategy(),
  new RoleBasedToolStrategy(),
]);

const activeTools = await applyToolStrategy(registry.getAll(), compositeStrategy, {
  phase: "discovery",
  role: "SALES",
});

// Directly pass to Vercel AI SDK:
// await generateText({ model, tools: activeTools, prompt: "..." });
```

---

## 🏷️ 5. Tool ID, Aliasing & Anonymization

Separate your internal database/API names from the public labels exposed to the LLM:

```typescript
import { createIsolatedTool, ToolRegistry } from "avantgate/agent";
import { z } from "zod";

export const payrollTool = createIsolatedTool({
  id: "sap_payroll_01",              // 🔑 Stable technical ID for O(1) KV lookup & audit logs
  name: "internal_sap_payroll_v2",   // 🏷️ Internal technical name
  alias: "lookup_employee_salary",    // 🔒 Sanitized public alias seen by the LLM
  description: "Lookup corporate employee salary info",
  parameters: z.object({ employeeId: z.string() }),
  async execute(args) {
    return await db.payrolls.find(args.employeeId);
  },
});

const registry = new ToolRegistry();
registry.register({
  id: payrollTool._toolId,
  name: payrollTool._toolName,
  alias: payrollTool._toolAlias,
  description: payrollTool.description,
  tool: payrollTool,
});

// Fast O(1) Lookups:
const tool = registry.getById("sap_payroll_01");
const toolByAlias = registry.getByPublicName("lookup_employee_salary");

// Export to Vercel AI SDK with anonymized keys:
const aiSdkTools = registry.toRecord({ anonymize: true });
// aiSdkTools will contain: { "lookup_employee_salary": payrollTool }
```

---

## 🔗 6. Tool Chaining, Anti-Cycles & DB Memory (Blackboard & Cache)

Allow tools to invoke sub-tools with cycle prevention, memory caching, and database telemetry:

```typescript
import { createIsolatedTool, createToolInvoker, SQLiteStorageAdapter } from "avantgate/agent";
import Database from "better-sqlite3";

const db = new Database("workflow.db");
const storage = new SQLiteStorageAdapter(db); // Automatically creates tool execution & cache tables

// 1. Sub-tool with idempotency caching
const taxCalculator = createIsolatedTool({
  id: "calc_vat",
  name: "calc_vat",
  description: "Calculate VAT",
  cacheTTL: 3600, // 💾 Results cached for 1h in SQLite/memory (avoid re-computation on identical queries)
  parameters: z.object({ amount: z.number() }),
  async execute(args, context) {
    // Shared Blackboard state access
    await context?.state?.set("last_amount", args.amount);
    return { vat: args.amount * 0.2 };
  },
});

// 2. Parent tool invoking sub-tool safely
const quoteGenerator = createIsolatedTool({
  id: "generate_quote",
  name: "generate_quote",
  description: "Generate official customer quote",
  parameters: z.object({ amount: z.number() }),
  async execute(args, context) {
    // 🔗 Safe sub-tool invocation (concurrency-safe & cycle-protected)
    const vatRes = await context?.callTool<{ vat: number }>("calc_vat", {
      amount: args.amount,
    });
    return {
      subtotal: args.amount,
      vat: vatRes?.vat ?? 0,
      total: args.amount + (vatRes?.vat ?? 0),
    };
  },
});

// 3. Dispatcher with cycle guard and database tracing
const invoker = createToolInvoker(registry, storage, {
  maxDepth: 5,           // Throws ToolCallDepthExceededError if depth > 5
  maxTotalSubCalls: 20,  // Throws ToolSubCallQuotaError if calls > 20
});

// Traces recorded in avantgate_tool_executions table:
const quote = await invoker.invokeTool("generate_quote", { amount: 500 });
```

---

## 📡 6. Observability, Telemetry & Cloud Platform Bridge

`avantgate/agent` connects directly to the avantGate Observability Platform or any custom HTTP telemetry sink using non-blocking, zero-dependency background batching.

### A. HttpTelemetryExporter ($0 Infrastructure & Fire-and-Forget)

Sends events asynchronously to `POST /api/v1/ingest/events` with automatic token and cost aggregation:

```typescript
import { HttpTelemetryExporter } from "avantgate/agent";

const exporter = new HttpTelemetryExporter({
  apiKey: process.env.AVANTGATE_API_KEY!, // e.g. "ag_live_..."
  agentName: "sales-assistant",
  batchIntervalMs: 5000,                  // Flush every 5 seconds
  maxBatchSize: 50,                       // Or when 50 events are buffered
  onError: (err) => console.error("Telemetry failed:", err),
});
```

### B. PlatformStorageAdapter (Hexagonal Hybrid Mirror)

Preserves local durability (SQLite, Prisma, Memory) while mirroring step lifecycles and tool execution trees to the cloud in real time:

```typescript
import {
  PlatformStorageAdapter,
  SQLiteStorageAdapter,
  HttpTelemetryExporter,
  createStepRunner,
} from "avantgate/agent";
import Database from "better-sqlite3";

const db = new Database("agent.db");
const localDb = new SQLiteStorageAdapter(db);

const exporter = new HttpTelemetryExporter({
  apiKey: process.env.AVANTGATE_API_KEY!,
});

// Hybrid adapter: writes to SQLite immediately, mirrors to Cloud asynchronously
const storage = new PlatformStorageAdapter({
  primaryStorage: localDb,
  exporter,
});

const runner = createStepRunner({
  workflowId: "order-wf-42",
  runId: "session-run-42",
  storage,
});
```

---

## 🛡️ 7. Tool Governance, Business Domains & Access Control

Control tool execution, prevent IDOR vulnerabilities, enforce the Golden Triad of Tool Governance (`roles` IAM vs `impact` AI blast radius vs `requireApproval` HITL), and emit universal cache invalidation tags:

### A. Declarative Metadata & Security Guards

```typescript
import { createIsolatedTool, ToolAccessDeniedError } from "avantgate/agent";
import { z } from "zod";

export const deleteProspectTool = createIsolatedTool({
  name: "delete_prospect",
  domain: "crm",                  // 🏢 Business domain
  resource: "prospects",          // 📦 Specific entity
  roles: ["ADMIN"],               // 👥 Native RBAC: verified against context.roles before execute()
  impact: "DESTRUCTIVE",          // 🛡️ Physical impact: "READ_ONLY" | "MUTATIVE" | "DESTRUCTIVE"
  requireApproval: true,          // ✋ Safe default: auto-enabled for DESTRUCTIVE tools

  // 🛡️ Anti-IDOR Fail-Safe: Asserts that the deleted/retrieved entity belongs to the session tenant
  assertTenant: (record) => record.tenantId,

  // 🏷️ Universal cache invalidation tags (Next.js revalidateTag or TanStack Query)
  invalidationTags: (args) => ["crm:prospects", `crm:prospects:${args.id}`],

  // 🚫 Parameters: Never ask the model for tenantId. It is resolved securely via server context!
  parameters: z.object({ id: z.string() }),
  async execute(args, context) {
    // 🛡️ Defense-in-depth: Scoped database query using session tenant
    return await db.prospects.delete({
      where: {
        id: args.id,
        tenantId: context?.tenantId,
      },
    });
  },
});
```

### Anti-IDOR Post-Fetch & Ownership Assertions
AvantGate provides dual-layer Anti-IDOR defense:
1. **`assertTenant: (result) => result.tenantId`** : Synchronous guard asserting that the retrieved entity matches `context.tenantId`. If a cross-tenant collision or query leakage occurs, AvantGate immediately throws `ToolAccessDeniedError` before data reaches `llmDto` or `clientDto`.
2. **`assertOwnership: async (result, context) => boolean | Promise<boolean>`** : Universal predicate for complex data models, indirect ownership (e.g. `result.customer.tenantId`), or B2C user-scoped access (`result.userId === context.userId`).
3. **`createTenantTool(config)` (Compile-Time Enforcement)** : High-assurance factory that strictly requires either `assertTenant` or `assertOwnership` at TypeScript compile-time. If neither is provided, TypeScript refuses compilation.
4. **Native RBAC** : When `roles` is declared on an isolated tool, execution is automatically restricted to callers providing matching `context.roles` or `context.role`.

### B. Cognitive Confinement & Unified Strategy (`AccessControlToolStrategy`)

Evaluates user roles, allowed business domains, and maximum impact ceiling in a single pass:

```typescript
import {
  ToolRegistry,
  AccessControlToolStrategy,
  ReadOnlyToolStrategy,
  MaxImpactToolStrategy,
} from "avantgate/agent";

const registry = new ToolRegistry();
registry.registerMany([createProspectTool, deleteProspectTool, sendInvoiceTool]);

// 1. Restrict tools to "crm" domain for a sales user, capped at MUTATIVE impact
const strategy = new AccessControlToolStrategy({
  allowedDomains: ["crm"],
  maxImpact: "MUTATIVE", // Excludes DESTRUCTIVE tools (e.g. delete_prospect)
});

const toolsForSales = strategy.selectTools(registry.getAll(), {
  role: "SALES",
});

// Pass directly to Vercel AI SDK
const aiTools = ToolRegistry.toRecord(toolsForSales);

// 2. Pure Read-Only strategy (Strictly non-mutative tools for auditor/critic/planner agents)
const criticStrategy = new ReadOnlyToolStrategy();
const auditorTools = criticStrategy.selectTools(registry.getAll(), {});
```

### C. Headless Descriptors & Domain Partitioning

Export technical tool definitions without UI coupling, or partition tools by domain/impact:

```typescript
// 1. Batch registration
registry.registerMany([toolA, toolB, toolC]);

// 2. Filter by domain or impact
const crmTools = registry.getByDomain("crm");
const safeTools = registry.getByImpact("READ_ONLY");

// 3. Headless metadata export for client UI
const descriptors = registry.getDescriptors({ domain: "crm", role: "ADMIN" });
// Returns: [{ id, name, domain, resource, roles, impact, requireApproval, tags }]
```

