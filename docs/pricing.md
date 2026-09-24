# 💰 Complete Pricing & FinOps Architecture Guide (`avantgate` & `gatewall`)

> **Monitor, audit, and cap your LLM spend in real time without stale prices, proxy latency, or invented estimates.**

---

## 🎯 Philosophy: "Strict & Truthful" (Zero Hardcoded Guesswork)

Unlike passive proxies that hardcode outdated pricing snapshots from months ago:
- **AvantGate starts with an empty pricing registry by default**: No fake or approximate costs. If a model has no configured price, its tracked cost is `$0.00` (while token consumption is still recorded with 100% precision).
- **Pre-flight financial safety**: When enabling spend caps (`maxCostUSD: 0.01`), AvantGate strictly requires that model pricing is declared so it can block abusive requests before making any billable network call.
- **Strict Source Priority**: When telemetry is streamed to the GateWall cockpit, cost calculated at source by the agent SDK is preserved with 100% fidelity. GateWall only computes a fallback estimate if an uninstrumented caller omits `costUsd`.

---

## 🏗️ End-to-End FinOps Architecture: AvantGate vs. GateWall

In an autonomous AI agent architecture, financial cost estimation occurs at **two distinct stages in the request lifecycle**:

1. **At the source (Client in-process with `avantgate`)**: for **active defense** and pre-flight spending protection (*Pre-Flight Budget Guard*).
2. **At ingestion (GateWall Cockpit)**: for **audit consolidation**, FinOps reporting, and graceful support for third-party uninstrumented agents.

```mermaid
flowchart TD
    subgraph Client ["Client Runtime (Agent / avantgate)"]
        Req[Agent Request] --> Guard["🛡️ Ingress & Pre-Flight Guard<br/>maxCostUSD"]
        Guard -- Budget OK --> LLMCall["🤖 Provider LLM Call"]
        LLMCall --> SourceCost["💰 avantgate/src/pricing.ts<br/>Exact source cost + Prompt Cache discount"]
        SourceCost --> EventGen["📦 Build Telemetry Payload<br/>usage.costUsd = 0.00012"]
    end

    subgraph Platform ["GateWall Cockpit (/api/v1/ingest/events)"]
        EventGen --> Ingest{"Is payload.usage.costUsd<br/>defined?"}
        Ingest -- "YES (AvantGate Agent)" --> Direct["✅ Primary Source Cost<br/>(100% faithful to execution)"]
        Ingest -- "NO (Third-party / LangChain / curl)" --> Fallback["⚙️ fallback-cost-calculator.ts<br/>calculateFallbackTokenCost()"]
        Direct --> SessionStore["💾 Persist Session Run<br/>SQLite + FinOps Dashboard"]
        Fallback --> SessionStore
    end
```

### Resolution Rule (Strict Source Priority)

In the GateWall ingestion pipeline ([telemetry-store.ts](file:///c:/Users/Bui/Desktop/DevProjets/avantGate/gatewall/lib/storage/telemetry-store.ts)):

```typescript
const costUsd =
  payload.usage?.costUsd !== undefined
    ? payload.usage.costUsd
    : calculateFallbackTokenCost(modelName, promptTokens, completionTokens);
```

1. **If `costUsd` is provided** (standard behavior with `avantgate` SDK): the source value is preserved intact. No recalculation occurs.
2. **If `costUsd` equals `0.0`** (e.g., local Ollama models): the zero cost is strictly preserved thanks to the `!== undefined` guard.
3. **If `costUsd` is absent**: GateWall computes a server-side fallback estimate via `calculateFallbackTokenCost`.

---

## 🛠️ The 4 Configuration Methods in `avantgate`

```mermaid
flowchart TD
    Req[LLM Request] --> P1{1. ProviderConfig.pricing ?}
    P1 -- Yes --> UseP1[Provider-specific price]
    P1 -- No --> P2{2. ControlLayerConfig.customPricing ?}
    P2 -- Yes --> UseP2[Instance customPricing price]
    P2 -- No --> P3{3. Database PricingAdapter with RAM Cache?}
    P3 -- Yes --> UseP3[Database price]
    P3 -- No --> P4{4. Global PricingRegistry?}
    P4 -- Yes --> UseP4[Globally registered price]
    P4 -- No --> Zero[Cost = $0.00 / maxCostUSD Rejection]
```

### Method 1: Direct Declaration in Provider (Fastest)

Ideal for quick prototyping, lightweight scripts, or applying negotiated enterprise discount tiers:

```typescript
import { createAvantGate } from "avantgate";

const control = createAvantGate({
  primary: {
    provider: "deepseek",
    model: "deepseek-chat",
    apiKey: process.env.DEEPSEEK_API_KEY!,
    // 💡 Direct pricing per million tokens
    pricing: {
      promptUSDPerMillion: 0.14,
      completionUSDPerMillion: 0.28,
      cacheHitUSDPerMillion: 0.014, // Optional: discounted KV cache hit rate
    },
  },
  maxCostUSD: 0.005, // Blocks pre-flight if minimum input cost exceeds $0.005
});

const result = await control.execute({
  userQuery: "Generate executive summary...",
});

console.log(`Exact cost: $${result.costUSD.toFixed(6)}`);
```

---

### Method 2: Instance Pricing Grid (`customPricing`)

Ideal when your application routes queries across multiple models and distributor endpoints:

```typescript
import { createAvantGate } from "avantgate";

const control = createAvantGate({
  primary: { provider: "deepseek", model: "deepseek-chat", apiKey: process.env.DEEPSEEK_API_KEY! },
  fallback: { provider: "mistral", model: "mistral-small-latest", apiKey: process.env.MISTRAL_API_KEY! },

  customPricing: {
    // Simple key by model name
    "deepseek-chat": { promptUSDPerMillion: 0.14, completionUSDPerMillion: 0.28 },
    "mistral-small-latest": { promptUSDPerMillion: 0.20, completionUSDPerMillion: 0.60 },

    // Qualified key by distributor (e.g., via OpenRouter or Azure)
    "openrouter/anthropic/claude-3.5-sonnet": { promptUSDPerMillion: 3.00, completionUSDPerMillion: 15.00 },
    "azure/gpt-4o": { promptUSDPerMillion: 2.75, completionUSDPerMillion: 11.00 },
  },
});
```

---

### Method 3: Database Connection (`PricingAdapter` with RAM Cache)

This is **the recommended production architecture for multi-tenant SaaS applications**.  
Model pricing is stored in a SQL database (PostgreSQL, MySQL, SQLite) and managed via your internal admin dashboard.

#### A. Recommended Prisma Schema

```prisma
model ModelPricing {
  id                     String    @id @default(cuid())
  distributor            String    // "deepseek", "mistral", "openrouter", "openai", "azure"
  model                  String    // "deepseek-chat", "mistral-large-latest", "gpt-4o"
  promptPriceUSDPerM     Decimal   @db.Decimal(10, 4) // e.g. 0.1400
  completionPriceUSDPerM Decimal   @db.Decimal(10, 4) // e.g. 0.2800
  cacheHitPriceUSDPerM   Decimal?  @db.Decimal(10, 4) // e.g. 0.0140
  isActive               Boolean   @default(true)
  updatedAt              DateTime  @updatedAt

  @@unique([distributor, model])
}
```

#### B. Wiring into AvantGate with In-Memory Caching (0 ms Overhead)

```typescript
import { createAvantGate, type PricingAdapter } from "avantgate";
import { prisma } from "@/lib/prisma";

const control = createAvantGate({
  primary: { provider: "deepseek", model: "deepseek-chat", apiKey: process.env.DEEPSEEK_API_KEY! },

  // 💡 The adapter queries Prisma only on cache misses
  pricingAdapter: {
    async fetchPrice(model, provider) {
      const row = await prisma.modelPricing.findFirst({
        where: { model, distributor: provider, isActive: true },
      });
      if (!row) return undefined;

      return {
        promptUSDPerMillion: Number(row.promptPriceUSDPerM),
        completionUSDPerMillion: Number(row.completionPriceUSDPerM),
        cacheHitUSDPerMillion: row.cacheHitPriceUSDPerM ? Number(row.cacheHitPriceUSDPerM) : undefined,
      };
    },
  },

  // ⚡ In-memory cache TTL (5 minutes by default)
  pricingCacheTtlMs: 5 * 60 * 1000,
});
```

#### C. Hot-Cache Invalidation on Admin Updates

When an administrator updates a price in your web back-office:

```typescript
import { CachedPricingAdapter } from "avantgate";

// In your Next.js Server Action or Express API route:
export async function updateModelPrice(distributor: string, model: string, newPrompt: number, newCompletion: number) {
  await prisma.modelPricing.update({
    where: { distributor_model: { distributor, model } },
    data: { promptPriceUSDPerM: newPrompt, completionPriceUSDPerM: newCompletion },
  });

  // 💡 Immediately invalidate the RAM cache without restarting the app
  cachedPricingAdapter.invalidate(model, distributor);
}
```

---

### Method 4: Decoupled Global Registry (`PricingRegistry`)

Configure prices once at application bootstrap:

```typescript
import { PricingRegistry } from "avantgate";

// Register an individual model price
PricingRegistry.registerPrice("deepseek-chat", {
  promptUSDPerMillion: 0.14,
  completionUSDPerMillion: 0.28,
});

// Register prices for an entire distributor catalog
PricingRegistry.registerDistributorPrices("openrouter", {
  "deepseek/deepseek-chat": { promptUSDPerMillion: 0.14, completionUSDPerMillion: 0.28 },
  "anthropic/claude-3.5-sonnet": { promptUSDPerMillion: 3.00, completionUSDPerMillion: 15.00 },
});
```

---

## 📦 Reference Seed Dataset (`SEED_MODEL_PRICES`)

AvantGate exports a starter catalog `SEED_MODEL_PRICES` to seed databases or bootstrap local testing:

```typescript
import { SEED_MODEL_PRICES, PricingRegistry } from "avantgate";
import { prisma } from "@/lib/prisma";

// Example Prisma seed script (prisma/seed.ts)
async function seedPrices() {
  for (const [key, price] of Object.entries(SEED_MODEL_PRICES)) {
    const [distributor, ...modelParts] = key.includes("/") ? key.split("/") : ["direct", key];
    const model = modelParts.join("/") || key;

    await prisma.modelPricing.upsert({
      where: { distributor_model: { distributor, model } },
      create: {
        distributor,
        model,
        promptPriceUSDPerM: price.promptUSDPerMillion,
        completionPriceUSDPerM: price.completionUSDPerMillion,
      },
      update: {},
    });
  }
}
```

---

## 🛡️ Pre-Flight Budget Guard Mechanics (`maxCostUSD`)

When configuring spend limits:

```typescript
const control = createAvantGate({
  primary: {
    provider: "deepseek",
    model: "deepseek-chat",
    apiKey: process.env.DEEPSEEK_API_KEY!,
    pricing: { promptUSDPerMillion: 0.14, completionUSDPerMillion: 0.28 },
  },
  maxCostUSD: 0.00005, // Very strict budget limit
});
```

AvantGate enforces a two-stage check:
1. **Pre-Flight Validation**: Estimates the minimum expected input cost (`promptTokens * promptUSDPerMillion / 1_000_000`). If this initial input cost exceeds `maxCostUSD`, the request is **rejected instantly with a `BudgetExceededError` before making any billable network call**.
2. **Post-Execution Validation**: After receiving the completion, validates that total actual cost respects the limit.
3. **Truth Requirement**: If `maxCostUSD` is enabled on a paid model without any registered price, AvantGate throws an explicit `ConfigurationError` rather than guessing a random price.

---

## 🖥️ GateWall Fallback Estimator & Reference Table

When events arrive at GateWall without `costUsd` (e.g. from LangChain, curl, or uninstrumented callers), GateWall applies its built-in fallback table ([fallback-cost-calculator.ts](file:///c:/Users/Bui/Desktop/DevProjets/avantGate/gatewall/lib/finops/fallback-cost-calculator.ts)):

| Family | Model | Prompt Cost (per 1M tokens) | Completion Cost (per 1M tokens) |
| :--- | :--- | :--- | :--- |
| **OpenAI** | `gpt-4o` | $2.50 | $10.00 |
| | `gpt-4o-mini` | $0.15 | $0.60 |
| | `gpt-4-turbo` | $10.00 | $30.00 |
| **Anthropic** | `claude-3-5-sonnet-20241022` | $3.00 | $15.00 |
| | `claude-3-5-haiku` | $0.80 | $4.00 |
| | `claude-3-opus` | $15.00 | $75.00 |
| **Google** | `gemini-1.5-pro` | $1.25 | $5.00 |
| | `gemini-1.5-flash` | $0.075 | $0.30 |
| | `gemini-2.0-flash` | $0.10 | $0.40 |
| **DeepSeek** | `deepseek-chat` | $0.14 | $0.28 |
| | `deepseek-reasoner` | $0.55 | $2.19 |
| **Local** | `ollama` | $0.00 | $0.00 |

*If an unknown model is received without `costUsd`, GateWall applies a conservative fallback of `$0.20` prompt / `$0.80` completion per 1M tokens.*

---

## 📊 Comparison Matrix: AvantGate SDK vs. GateWall Cockpit

| Feature | AvantGate SDK (`src/pricing.ts`) | GateWall Platform (`fallback-cost-calculator.ts`) |
| :--- | :--- | :--- |
| **Execution Environment** | In-Process (Agent Runtime) | Server / Observability Cockpit |
| **Evaluation Timing** | **Before & During** LLM invocation | **After** receiving telemetry ingestion payload |
| **Primary Objective** | Pre-flight budget blocking (`maxCostUSD`) | Observability, auditing & FinOps analytics |
| **Prompt Cache Awareness** | ✅ Yes (`cacheHitUSDPerMillion`) | ❌ No (proportional linear calculation) |
| **Pricing Source** | Runtime config, DB adapter, or global registry | Built-in fallback table (`FALLBACK_MODEL_PRICING_TABLE`) |
| **Bundled Models** | DeepSeek, Mistral, OpenAI, OpenRouter, Ollama | GPT-4o, Claude 3.5, Gemini 1.5/2.0, DeepSeek, Ollama |
| **Unknown Model Default** | `$0.00` (strict principle: never invent costs) | `$0.20 / $0.80` per 1M tokens (conservative fallback) |
