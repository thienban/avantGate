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
  CompositeToolStrategy,
} from "avantgate/agent";
```

---

## 🛡️ 1. Tool Data Isolation (Dual-Channel PII Shield)

Wrap your tools with `createIsolatedTool` to separate client-side rich data from LLM context:

```typescript
import { z } from "zod";
import { createIsolatedTool } from "avantgate/agent";

export const searchClientsTool = createIsolatedTool({
  name: "search_clients",
  description: "Search corporate client database",
  parameters: z.object({
    industry: z.string(),
  }),
  // 1. Raw execution logic
  async execute(args) {
    return {
      industry: args.industry,
      clients: [
        { name: "John Doe", email: "john@enterprise.com", phone: "06 12 34 56 78" },
      ],
    };
  },
  // 2. Out-of-band channel (Client UI gets full, unredacted data)
  toClientData(data) {
    uiSocket.emit("client_data", data);
  },
  // 3. LLM channel (Model gets safe minimal summary with auto-PII redaction)
  toLLMSummary(data) {
    return {
      count: data.clients.length,
      note: "Results dispatched to user interface.",
    };
  },
  sanitizePii: true, // Auto-redacts emails, phones, French NIR/SPI, IBAN/BIC
});
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
