# 🤖 Isolated Tools & Dual-Channel Governance (`avantgate/agent`)

AvantGate wraps AI agent tools (compatible with Vercel AI SDK `ai`) with strict access governance, dual-channel projection (`llmDto` vs `clientDto`), in-flight PII redaction, and caching.

---

## ⚡ Key Concepts

* **Dual-Channel Separation**: The model receives only a minimal, safe acknowledgment or whitelisted fields (`llmDto`). The client application or UI receives the full unredacted record directly (`clientDto`).
* **Governance & IAM**: Tools declare `domain`, `resource`, `roles`, and `impact` ("READ_ONLY" | "MUTATIVE" | "DESTRUCTIVE").
* **Compile-Time Multi-Tenant Safety**: Use `createTenantTool` to mandate `assertTenant` or `assertOwnership` at compile time.

---

## 💻 1. Minimal DTO Helpers (`dto`)

```typescript
import { createIsolatedTool, dto } from "avantgate/agent";
import { z } from "zod";

export const deleteUserTool = createIsolatedTool({
  name: "delete_user",
  domain: "users",
  roles: ["ADMIN"],
  impact: "DESTRUCTIVE",
  requireApproval: true,
  parameters: z.object({ userId: z.string() }),
  async execute(args) {
    return await db.users.delete({ where: { id: args.userId } });
  },
  // LLM receives only: { success: true, id: "user_123" }
  llmDto: dto.booleanWithId("userId"),
});
```

---

## 💻 2. Dynamic Tool Filtering by Role & Domain

```typescript
import { ToolRegistry, AccessControlToolStrategy } from "avantgate/agent";

const registry = new ToolRegistry();
registry.registerMany([createLeadTool, deleteUserTool, sendInvoiceTool]);

const strategy = new AccessControlToolStrategy({
  allowedDomains: ["crm"],
  maxImpact: "MUTATIVE", // Excludes DESTRUCTIVE deleteUserTool
});

// Selects only tools accessible to SALES role in "crm" domain
const salesTools = strategy.selectTools(registry.getAll(), { role: "SALES" });

// Convert to Vercel AI SDK tools object:
const aiTools = ToolRegistry.toRecord(salesTools);
```

---

## 🔗 Related Agent Guides

* [Anti-IDOR & Multi-Tenant Defense](../security/anti-idor.md) — Protect against cross-tenant data leaks.
* [Inter-Tool Chaining & Blackboard State](inter-tool-chaining.md) — Sub-calls and shared state memory.
* [Durable Workflows](../workflows/durable-workflows.md) — Multi-step Saga orchestrations.
