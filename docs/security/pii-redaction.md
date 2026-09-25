# 🔒 Zero-Egress In-Flight PII Redaction (`avantgate`)

AvantGate scrubs Personally Identifiable Information (PII) from user prompts **locally in-memory**, before raw text leaves your private perimeter to external cloud LLMs (OpenAI, DeepSeek, Mistral, Anthropic).

---

## ⚡ Supported PII Patterns

| Pattern Category | Examples Detected | Redacted Output Token |
|---|---|---|
| **French Social Security (NIR)** | `1 85 05 75 012 345 67` | `[NIR_SSN_REDACTED]` |
| **French Tax ID (SPI)** | `01 23 456 789 012` | `[SPI_TAX_ID_REDACTED]` |
| **Banking Identifiers (IBAN / BIC)**| `FR76 3000 6000 0112 3456 7890 189` | `[IBAN_REDACTED]` |
| **Emails & User Accounts** | `claire.dupont@entreprise.com` | `[EMAIL_REDACTED]` |
| **Phone Numbers** | `+33 6 12 34 56 78`, `06.12.34.56.78` | `[PHONE_REDACTED]` |
| **API Keys & Secrets** | `sk-proj-abc123...`, `ghp_xxx...` | `[SECRET_API_KEY_REDACTED]` |

---

## 💻 Quickstart Recipe

```typescript
import { createAvantGate, PiiLeakError } from "avantgate";

const engine = createAvantGate({
  primary: {
    provider: "deepseek",
    model: "deepseek-chat",
    apiKey: process.env.DEEPSEEK_API_KEY!,
  },
  security: {
    maskPII: true,       // In-flight automatic masking
    throwOnPii: false,   // If true, throws PiiLeakError instead of masking
  },
});

// Prompt containing raw PII:
const response = await engine.execute({
  userQuery: "Please process refund for Alice (email: alice@client.fr, IBAN: FR7630006000011234567890189).",
});

// The prompt dispatched to the external LLM provider was automatically transformed into:
// "Please process refund for Alice (email: [EMAIL_REDACTED], IBAN: [IBAN_REDACTED])."
console.log("Tokens processed:", response.tokens.total);
```

---

## 🎭 Dual-Channel PII Escrow (Agent Tools)

In agentic workflows, database records can contain PII that the model shouldn't see, but the UI client needs to render:

```typescript
import { createIsolatedTool, dto } from "avantgate/agent";

export const getCustomerTool = createIsolatedTool({
  name: "get_customer",
  parameters: z.object({ customerId: z.string() }),
  async execute(args) {
    return await db.customers.findById(args.customerId);
  },
  // 1. Model receives minimal, sanitized summary:
  llmDto: dto.pick(["id", "status"]),
  // 2. Client UI receives the full unredacted record directly via WebSocket/SSE:
  clientDto(customer) {
    uiSocket.emit("customer_card", customer);
  },
  sanitizePii: true, // Deep recursive scan on tool output
});
```

---

## 🔗 Related Guides

* [Prompt Guardrails](prompt-guardrails.md) — Protect against prompt injections.
* [Anti-IDOR & Multi-Tenant Defense](anti-idor.md) — Enforce data boundaries across tenants.
* [GateWall Cockpit](../observability/gatewall-cockpit.md) — Visual side-by-side PII inspection dashboard.
