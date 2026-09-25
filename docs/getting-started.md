# 🚀 Getting Started with AvantGate (`avantgate`)

AvantGate is an in-process AI Application Firewall (AI-WAF), FinOps cost control plane, and agent security runtime for TypeScript. It runs directly inside your Node.js or Bun process with **0 ms extra network hop** and **zero external infrastructure**.

---

## 📦 Installation

```bash
npm install avantgate zod
# or
bun add avantgate zod
# or
pnpm add avantgate zod
```

---

## ⚡ 3-Minute Quickstart

### 1. In-Process AI Firewall & Cost Control
Execute an LLM query with automated prompt injection detection, PII redaction, and token budgeting:

```typescript
import { createAvantGate } from "avantgate";

const gate = createAvantGate({
  primary: {
    provider: "deepseek",
    model: "deepseek-chat",
    apiKey: process.env.DEEPSEEK_API_KEY!,
  },
  security: {
    detectPromptInjection: true, // Blocks jailbreaks and prompt leaks
    maskPII: true,                // Locally masks emails, phones, IBAN, French NIR/SPI
  },
  maxTokenBudget: 2000,          // Denial-of-Wallet defense
});

const response = await gate.execute({
  systemPrompt: "You are an AI assistant.",
  userQuery: "Hello, my email is alice@company.fr. What is EBITDA?",
});

console.log(response.text);
console.log(`Tokens used: ${response.tokens.total}`);
console.log(`Cost: $${response.costUSD.toFixed(6)}`);
```

---

### 2. High-Assurance Agent Tools (Compile-Time Anti-IDOR)
Create an isolated tool that strictly validates multi-tenant boundaries at compile-time:

```typescript
import { createTenantTool, dto } from "avantgate/agent";
import { z } from "zod";

export const getInvoiceTool = createTenantTool({
  name: "get_invoice",
  domain: "billing",
  roles: ["FINANCE", "ADMIN"],
  parameters: z.object({ invoiceId: z.string() }),
  
  // 🛡️ Required at compile-time: asserts record belongs to the calling tenant
  assertTenant: (invoice) => invoice.tenantId,

  async execute(args, context) {
    const invoice = await db.invoices.findOne({
      where: { id: args.invoiceId, tenantId: context?.tenantId },
    });
    if (!invoice) throw new Error("Invoice not found");
    return invoice;
  },

  // LLM receives only safe minimal fields; client UI receives full raw record out-of-band:
  llmDto: dto.pick(["invoiceId", "totalAmount", "status"]),
});
```

---

## 🗺️ Documentation Directory

Explore the complete documentation organized by functional pillars:

| Pillar | Focus Area | Guides |
|---|---|---|
| 🛡️ **Security & AI-WAF** | Jailbreak defense, PII masking & Anti-IDOR | [Prompt Guardrails](security/prompt-guardrails.md) • [PII Redaction](security/pii-redaction.md) • [Anti-IDOR Defense](security/anti-idor.md) • [End-to-End Security](security/end-to-end-security.md) |
| 💰 **FinOps & Cost** | Token budgets & dynamic pricing | [Pre-Flight Budget Guards](finops/budget-guards.md) • [Pricing Adapters & SQLite](finops/pricing-adapters.md) |
| 🤖 **Agents & IAM** | Isolated tools, RBAC & state sharing | [Isolated Tools & DTOs](agents/isolated-tools.md) • [Agent Runtime Manual](agents/agent-runtime.md) • [Inter-Tool Chaining](agents/inter-tool-chaining.md) |
| 🔄 **Workflows** | Sagas, checkpoints & Human-in-the-Loop | [Durable Workflows Engine](workflows/durable-workflows.md) |
| 📊 **Observability** | Cockpit UI, telemetry & React hook | [GateWall Cockpit](observability/gatewall-cockpit.md) • [Telemetry & Browser SDK](observability/telemetry-and-browser-sdk.md) |
| 💶 **Finance** | Normalization & European VAT | [Financial Normalizer](finance/normalizer.md) |
| 📖 **Cookbook** | Code recipes & cheat sheet | [AvantGate Cookbook](examples.md) |
