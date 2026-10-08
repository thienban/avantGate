# 🚀 AvantGate v2.3.0 — Release Notes

> **Release Date**: October 8, 2026  
> **NPM Package**: [`avantgate@2.3.0`](https://www.npmjs.com/package/avantgate)  
> **Release Type**: Feature & Hardening Release — Lifecycle Middleware Hooks (`beforeRequest`, `afterResponse`, Short-Circuit Cache & RAG Injection) and Hardened Launch-Safe Presets (`PRESETS.LAUNCH_SAFE`, `PRESETS.ENTERPRISE_STRICT`, `PRESETS.DEV_PERMISSIVE`).

---

## 📌 Executive Summary

Building enterprise-grade AI applications and copilots requires two essential pillars:
1. **Custom Interceptor Extensibility**: The ability to inspect, mutate, or short-circuit requests (e.g. injecting dynamic RAG context, local semantic caching, watermarking responses, or domain-specific safety policies) without having to fork the core SDK.
2. **Zero-Config Production Security**: Eliminating the risk of misconfiguration or forgotten guardrails by offering battle-tested, out-of-the-box presets that activate prompt injection defense, PII redaction, output DLP secret leak blocking, token budgeting, and automatic retries in a single line of code.

**AvantGate v2.3.0 introduces both capabilities while remaining 100% headless, in-process, and zero-dependency.**

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              AVANTGATE v2.3.0 ARCHITECTURE                             │
│                                                                                        │
│  1. Extensible Lifecycle Middlewares (src/middleware.ts)                               │
│     • AvantGateMiddleware interface with beforeRequest & afterResponse hooks           │
│     • Ingress Context Mutation: Dynamic RAG and system prompt injection                │
│     • Short-Circuit Bypass: Return cached answers with 0 tokens and $0 cost            │
│     • Downstream DLP Guarantee: applyOutputSecurityGuards always runs last              │
│                                                                                        │
│  2. Hardened Production Presets (src/presets.ts)                                       │
│     • PRESETS.LAUNCH_SAFE: Production default (Injection, PII, DLP REDACT, Retries)   │
│     • PRESETS.ENTERPRISE_STRICT: Regulated finance/health (DLP BLOCK, Strict Budgets)  │
│     • PRESETS.DEV_PERMISSIVE: Fast iteration for local testing and prototyping         │
│     • Deep Overrides: Partial customization without losing secure defaults             │
│                                                                                        │
│  3. Zero-Infra & In-Process Core (Zero External Dependencies)                          │
│     • 100% TypeScript, Arrow Functions exclusively, strict SRP (<= 20 lines/fn)       │
│     • Full test coverage across all suites (core, agent, workflow, client, UI)        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🌟 Key Highlights of v2.3.0

### 1. 🔌 Lifecycle Middleware Hooks (`AvantGateMiddleware`) ([FEAT-033](../../tickets/FEAT/FEAT-033-lifecycle-middleware-hooks.md))

AvantGate now features a sequential in-process interceptor engine allowing developers to hook into the lifecycle of every prompt:

- **`beforeRequest(context: BeforeRequestContext)`**:
  - **Dynamic RAG Context Injection**: Prepend system context or enrich messages before pre-flight budget calculations and provider calls.
  - **Short-Circuit / Local Semantic Cache**: Return `{ shortCircuit: { text, costUSD: 0 } }` to immediately bypass the provider. Avoids token consumption and network calls (`attempts: 0`), while still passing through output security scanning and audit logging.
  - **Custom Exception Interception**: Throw domain exceptions to immediately halt prompt execution.
- **`afterResponse(context: AfterResponseContext)`**:
  - Transform, enrich, or watermark LLM responses before delivery to the client.
  - Receive comprehensive execution metrics (`tokens`, `costUSD`, `attempts`, `failoverOccurred`).
- **Safety Guarantee**:
  - Output DLP and Secret Guards (`applyOutputSecurityGuards`) always execute **after** `afterResponse` hooks, ensuring no middleware can accidentally leak credentials or unmasked PII.

```typescript
import { createAvantGate, type AvantGateMiddleware } from "avantgate";

const cacheMiddleware: AvantGateMiddleware = {
  name: "local-cache",
  beforeRequest: async ({ messages }) => {
    const key = messages[messages.length - 1].content;
    const hit = localCache.get(key);
    if (hit) {
      return { shortCircuit: { text: hit, costUSD: 0 } };
    }
  },
};

const watermarkMiddleware: AvantGateMiddleware = {
  name: "watermark",
  afterResponse: async ({ responseText }) => ({
    responseText: `${responseText}\n\n---\n[AvantGate Verified]`,
  }),
};

const gate = createAvantGate({
  primary: { provider: "openai", model: "gpt-4o", apiKey: process.env.OPENAI_API_KEY! },
  middlewares: [cacheMiddleware, watermarkMiddleware],
});
```

---

### 2. 🚀 Hardened Launch-Safe Presets (`PRESETS.LAUNCH_SAFE`) ([FEAT-034](../../tickets/FEAT/FEAT-034-launch-safe-presets.md))

Instantiating a secure, production-grade AI firewall previously required configuring over a dozen distinct properties. AvantGate v2.3.0 provides zero-config, standardized profiles:

- **`PRESETS.LAUNCH_SAFE` (Recommended Production Baseline)**:
  - `detectPromptInjection: true`
  - `maskPII: true`
  - `outputDLP: true`
  - `blockSecretLeaks: true` (`secretLeakAction: "REDACT"`)
  - `maxTokenBudget: 8192`
  - `maxCostUSD: 0.50`
  - `retryOptions`: 2 retries, initial delay 300ms, backoff factor 1.5
- **`PRESETS.ENTERPRISE_STRICT` (Banking & Regulated Environments)**:
  - Hard stop on credential leaks via `SecretLeakBlockedError` (`secretLeakAction: "BLOCK"`)
  - Strict token budget (`4096` tokens) and cost cap (`$0.15` per query)
  - 3 retries with 500ms initial backoff and factor 2.0
- **`PRESETS.DEV_PERMISSIVE` (Local Prototyping)**:
  - Permissive defaults with disabled guards for rapid testing.
- **Deep Overrides Support**:
  - Easily customize individual parameters while preserving other secure defaults:
    ```typescript
    const gate = createAvantGate(
      PRESETS.LAUNCH_SAFE({
        primary: { provider: "openai", model: "gpt-4o", apiKey: process.env.OPENAI_API_KEY! },
        maxCostUSD: 1.0, // Overrides cost limit while preserving all security defaults
      })
    );
    ```

---

## 🧪 Quality & Verification

- **100% Pass Rate**: Verified against all test suites:
  - `tests/middleware-lifecycle.test.ts` (7 assertions verifying mutations, short-circuits, order, DLP guarantees, structured outputs).
  - `tests/presets.test.ts` (6 assertions verifying defaults, redactions, blocking, and deep overrides).
  - All existing suites (`tests/agent/*`, `tests/workflow/*`, `tests/client/*`, `tests/ui/*`).
- **Compilation & Type Emission**: Clean builds with `tsup` and `tsc` declaration generation.
- **Zero Runtime Dependencies**: No third-party packages added to npm runtime.

---

## 📦 Upgrade Guide

To upgrade your application to v2.3.0:

```bash
npm install avantgate@2.3.0
```
