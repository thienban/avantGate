# 🚀 AvantGate v1.1.1 — Release Notes

> **Release Date**: September 15, 2026  
> **NPM Package**: [`avantgate@1.1.1`](https://www.npmjs.com/package/avantgate)  
> **Release Type**: Critical Bugfixes, Budget Security & Architectural Improvements

---

## 📌 Executive Summary

The **v1.1.1** release of AvantGate brings fundamental fixes addressing direct feedback from developer onboarding and external technical audits:

1. **Delivering on Core Promise ("Pre-Flight In-Process Gating")**: `maxTokenBudget` and `maxCostUSD` limits now actively block requests before any external API expenditure occurs.
2. **End of Silent Mock Simulation**: Complete removal of automatic fallbacks to `executeSimulation()`. If no provider is configured, AvantGate throws an explicit `ConfigurationError`.
3. **Native HTTP Dispatch ($0 Dependencies)**: An integrated `fetch` client executes direct calls for DeepSeek, Mistral, OpenAI, Ollama, and OpenRouter without requiring third-party SDKs.
4. **"Strict & Truthful" Pricing Engine & DB Adapter**: Removal of hardcoded pricing dictionaries in favor of a decoupled registry and a `PricingAdapter` connectable to your database (e.g. Prisma, PostgreSQL) with zero-latency in-memory caching.
5. **Installation Name Clarification**: Definitive alignment on the official npm package name `avantgate` (resolving 404 errors from `@avantgate/core`).

---

## 🔍 Detailed Fixes & New Features

### 1. 🛡️ Active Pre-Flight Guarding (`maxTokenBudget` & `maxCostUSD`)
- **Problem Addressed**: Previously, `maxTokenBudget` and `maxCostUSD` were defined only in TypeScript types (`.d.ts`) but were never evaluated at runtime. A request configured with `maxTokenBudget: 1` returned a result without ever blocking.
- **v1.1.1 Behavior**:
  - **Pre-flight evaluation**: Before sending any request to the provider, AvantGate estimates the prompt token count (`Math.ceil(chars / 4)`).
  - **Token blocking**: If `promptTokens > maxTokenBudget`, a `BudgetExceededError` exception is thrown immediately.
  - **Cost blocking**: If the estimated input cost exceeds `maxCostUSD`, the request is blocked on the spot.
  - **Completion capping**: Completion tokens are bounded so they do not exceed remaining budget balance.
  - **Post-execution verification**: Strict checks against actual tokens and total cost returned by the provider.

```typescript
import { createAvantGate, BudgetExceededError } from "avantgate";

const control = createAvantGate({
  primary: { provider: "deepseek", model: "deepseek-chat", apiKey: process.env.DEEPSEEK_API_KEY! },
  maxTokenBudget: 100,
  maxCostUSD: 0.001,
});

try {
  await control.execute({ userQuery: "Exhaustive legal analysis of 50-page contract..." });
} catch (error) {
  if (error instanceof BudgetExceededError) {
    console.warn("Blocked pre-flight by AvantGate:", error.message);
  }
}
```

---

### 2. 🚫 Removal of Silent Simulation
- **Problem Addressed**: When no client was instantiated, `execute()` silently fell back to `this.executeSimulation()`, producing a mock response with calculated token and cost counts, even with invalid or missing API credentials.
- **v1.1.1 Behavior**:
  - Silent fallback to `executeSimulation()` is **permanently eliminated** from the production pipeline.
  - If no provider is functional, AvantGate throws an explicit `ConfigurationError`:
    ```
    [AvantGate Configuration Error] No active LLM provider configured. Provide a client implementing LLMProviderPort or configure credentials (apiKey / baseUrl).
    ```
  - Mock simulation is now strictly an opt-in testing tool for CI test suites, enabled only when setting `mockSimulation: true`.

---

### 3. 🌐 Native HTTP Client ($0 Dependencies, Node 18+ `fetch`)
- **Problem Addressed**: The README quickstart suggested passing `apiKey: process.env.DEEPSEEK_API_KEY!` without explaining how to instantiate the client.
- **v1.1.1 Behavior**:
  - Implementation of `HttpProviderClient` compatible with the standard `/chat/completions` protocol.
  - Native out-of-the-box support for **DeepSeek**, **Mistral**, **OpenAI**, **Ollama**, and **OpenRouter**.
  - If a user provides `apiKey` (or `baseUrl` for Ollama), AvantGate automatically instantiates the native HTTP client.
  - Provider errors (HTTP 401 Unauthorized, HTTP 429 Rate Limit, HTTP 500) are accurately intercepted and trigger automatic failovers if configured.

---

### 4. 💰 "Strict & Truthful" Pricing Engine & DB Adapter (`PricingAdapter`)
- **Problem Addressed**: Prices were hardcoded into a `BASELINE_PRICES` dictionary. These prices became quickly outdated and failed to reflect distributor markups (e.g. OpenRouter) or negotiated corporate discounts.
- **v1.1.1 Behavior**:
  - **Removal of hardcoded dictionary**: `PricingRegistry` starts 100% empty. No estimated or stale pricing is assumed (cost defaults to `$0.00` if unconfigured).
  - **Requirement of truth with `maxCostUSD`**: When a cost cap is defined, AvantGate requires the model to have registered pricing to prevent erroneous budget estimates.
  - **`PricingAdapter` interface for external databases (e.g. Prisma)**:
    ```typescript
    const control = createAvantGate({
      primary: { provider: "deepseek", model: "deepseek-chat", apiKey: process.env.DEEPSEEK_API_KEY! },
      pricingAdapter: {
        async fetchPrice(model, provider) {
          const row = await prisma.modelPricing.findFirst({ where: { model, distributor: provider } });
          if (!row) return undefined;
          return {
            promptUSDPerMillion: Number(row.promptPriceUSDPerM),
            completionUSDPerMillion: Number(row.completionPriceUSDPerM),
          };
        },
      },
      pricingCacheTtlMs: 5 * 60 * 1000, // In-memory cache 5 min (0 ms latency, 0 DB queries per prompt)
    });
    ```
  - **Hierarchical keys support**: `distributor/model` (e.g. `openrouter/deepseek/deepseek-chat`, `azure/gpt-4o`).
  - **Exported initial dataset**: `SEED_MODEL_PRICES` is exported to bootstrap your database seed scripts.

---

### 5. 📦 Package & Installation
- **Problem Addressed**: Legacy references mentioned `@avantgate/core` which returned HTTP 404 on npmjs.com.
- **v1.1.1 Behavior**:
  - Documentation and `package.json` are aligned on the single official npm publication:
    ```bash
    npm install avantgate zod
    ```

---

## 🧪 Test Matrix & Verification

| Test Suite | Status | Coverage |
|---|:---:|---|
| `tests/preflight-budget.test.ts` | ✅ **PASS** | Pre-flight rejection with `maxTokenBudget: 1`, `maxCostUSD` rejection, `ConfigurationError`, `PricingAdapter` TTL cache, and mock HTTP 401. |
| `tests/avantgate.test.ts` | ✅ **PASS** | Main control plane, automatic multi-model failover (HTTP 429), PII masking, prompt injection guard, Zod auto-repair. |
| `tests/financial-normalizer.test.ts` | ✅ **PASS** | Accounting normalizer, negative parentheses, k€ / M€ magnitudes. |
| `tests/prompt-builder.test.ts` | ✅ **PASS** | Structured prompt assembly, token slots, versioned templates. |
| `tests/pii-extended.test.ts` | ✅ **PASS** | French SSN/NIR, tax number (SPI), IBAN, BIC detection and masking. |
| `tests/agent/*` (9 files) | ✅ **PASS** | Durable StepRunner, HITL, Dual-Channel isolation, anti-cycle guard, PlatformStorageAdapter, HttpTelemetryExporter. |
| `npm run build` | ✅ **PASS** | CJS, ESM bundle generation, and TypeScript `.d.ts` declarations. |

---

## 📚 Related Documentation
- [Comprehensive Pricing Guide & DB Setup](pricing.md)
- [Durable Agent Module & Observability](agent.md)
- [Development Ticket FEAT-009](file:///c:/Users/Bui/Desktop/DevProjets/avantGate/tickets/FEAT-009-preflight-budget-guard-distributor-pricing-and-native-dispatch.md)
