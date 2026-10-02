# 🚀 AvantGate v2.0.0 — Release Notes

> **Release Date**: October 2, 2026  
> **NPM Package**: [`avantgate@2.0.0`](https://www.npmjs.com/package/avantgate)  
> **Release Type**: Major Milestone Release — Native Bidirectional Idempotency Engine, FinOps Ingest Deduplication, Universal Framework-Agnostic Task Runner, Server-Side In-Process Execution Guard, and GateWall Cockpit Storage Modularization.

---

## 📌 Executive Summary

Modern AI applications and autonomous agents operate across uncertain distributed boundaries:
1. **Outgoing Network Glitches**: Transient HTTP timeouts when calling OpenAI, Anthropic, or Stripe can cause client libraries to retry mutative operations, risking double billing or repeated side-effects.
2. **Client Double Submissions**: Users double-clicking submission buttons or unstable mobile connections re-triggering inference pipelines, wasting compute budgets and polluting audit trails.
3. **Telemetry Ingest Overcounting**: Network retries of telemetry batches inadvertently inflating FinOps metrics, reported token burn, and tool execution counts.

**AvantGate v2.0.0 establishes an end-to-end, zero-infrastructure Idempotency & FinOps Resilience layer**, without adding external message queues, Redis instances, or centralized gateway proxies:

- **Bidirectional Idempotency**: Full causal protection covering both **Outgoing** (Client $\to$ External Provider) and **Incoming** (Client $\to$ Your Server) execution flows.
- **FinOps Batch Deduplication**: High-performance, LRU-guarded idempotency on GateWall's `/api/v1/ingest/events` endpoint preventing duplicate accounting.
- **Universal Task Runner**: Framework-agnostic execution engine (`createTaskRunner`) powering our idiomatic React hook (`useTask`) with automatic causal parent-child tracking.
- **Clean Architecture & Storage Hardening**: Decoupled, modularized telemetry storage engine (`telemetry-store-helpers.ts`) compliant with strict Clean Code Single Responsibility Principles (SRP).

---

## 🌟 Key Highlights of v2.0.0

```
┌─────────────────────────┐                                ┌──────────────────────────┐                                ┌─────────────────────────┐
│       Client / UI       │  ── (1) Client ➔ Host Server ─> │       Host Server        │  ── (2) Host ➔ Provider ─> │    External Provider    │
│  useTask / TaskRunner   │      Idempotency-Key header     │  withServerIdempotency   │      Idempotency-Key       │  (OpenAI, Stripe, etc.) │
└─────────────────────────┘                                └──────────────────────────┘                                └─────────────────────────┘
```

### 1. 🔄 Outgoing Idempotency Propagation (Client ➔ External Provider) ([FEAT-028](../../tickets/FEAT/FEAT-028-native-idempotency-key-propagation-and-retry-deduplication.md))

When an agent tool or task retries, downstream providers (Stripe charges, LLM inference runs) must recognize the operation as a re-execution rather than a new action.

- **Exposition of `runId` in Execution Context**: `TaskExecutionContext` now exposes `{ runId, parentRunId, attempt, taskId, tenantId }`.
- **Causal Derivation Rule**:
  $$\text{IdempotencyKey} = \text{parentRunId} \;\text{??}\; \text{runId}$$
  - First run: Uses `runId`.
  - Replay / Retry: Preserves the causal `parentRunId`, notifying providers that this attempt is resolving the original failed request.
- **Zero-Dependency Helpers**:
  - `getIdempotencyKey(ctx)`: Extracts the canonical causal key.
  - `getIdempotencyHeaders(ctx)`: Generates `{ "Idempotency-Key": key }` ready for `fetch()` headers.

```typescript
import { useTask, getIdempotencyHeaders } from "avantgate/client";

const { run, retry } = useTask({
  taskId: "wire_transfer",
  handler: async (input, ctx) => {
    return await fetch("/api/transfers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getIdempotencyHeaders(ctx), // Automatically sets Idempotency-Key
      },
      body: JSON.stringify(input),
    }).then((res) => res.json());
  },
});
```

---

### 2. 🛡️ In-Process Server Idempotency Guard (Client ➔ Host Server)

Protects host backend endpoints (Next.js App Router, Express, Fastify) against duplicate execution without requiring Redis.

- **`withServerIdempotency(key, store, handler, ttlSeconds)`**:
  - If `key` is omitted: Executes handler normally without caching.
  - If `key` is cached: Immediately returns the cached result with `{ isCached: true }`, avoiding duplicate LLM calls and budget burn.
  - If `key` is fresh: Executes handler, saves the result to the store, and returns `{ isCached: false }`.
- **Pluggable Backends**:
  - `createMemoryIdempotencyStore()`: Zero-dependency in-memory TTL store for single-instance or serverless workers.
  - `createAdapterIdempotencyStore(adapter)`: Plugs directly into any AvantGate `StepStorageAdapter` (SQLite, PostgreSQL, Prisma, Redis).

```typescript
import {
  withServerIdempotency,
  createMemoryIdempotencyStore
} from "avantgate/agent";

const idempotencyStore = createMemoryIdempotencyStore();

export async function POST(req: Request) {
  const idempotencyKey = req.headers.get("Idempotency-Key");
  const payload = await req.json();

  const { result, isCached } = await withServerIdempotency(
    idempotencyKey,
    idempotencyStore,
    async () => {
      // High-cost LLM generation or agent tool execution
      return await myAgent.run(payload);
    },
    86400 // 24-hour TTL
  );

  return Response.json(result, {
    headers: { "X-Cache-Lookup": isCached ? "HIT" : "MISS" }
  });
}
```

---

### 3. 💰 GateWall Cockpit FinOps Deduplication

In distributed environments, telemetry exporters may re-send batches upon network hiccups. Prior to v2.0.0, this risked overcounting token consumption and USD costs.

- **Batch Idempotency (`batchId`)**: `/api/v1/ingest/events` tracks incoming `batchId` identifiers.
- **LRU Sliding Window**: Maintains up to 10,000 processed batches with an active 24-hour TTL pruning strategy.
- **Short-Circuit FinOps Ledger**: Re-sent batches return the existing `SessionRun` immediately without re-accumulating token counters, PII counts, or execution durations.

---

### 4. 🏃 Universal Framework-Agnostic Task Runner (`createTaskRunner`)

For applications built with Vue, Svelte, Angular, Solid, or vanilla Node.js/TypeScript, `createTaskRunner` provides the complete resilient execution lifecycle without a React dependency:

```typescript
import { createTaskRunner } from "avantgate/client";

const runner = createTaskRunner({
  taskId: "document_summary",
  maxManualRetries: 3,
  handler: async (docId, ctx) => {
    return summarizeDoc(docId, ctx.runId);
  },
});

// Reactive state subscription
const unsubscribe = runner.subscribe((state) => {
  console.log(`Status: ${state.status}, Attempt: ${state.attempts}`);
});

await runner.run("doc_12345");
```

---

### 5. 🧼 Clean Architecture & Storage Modularization

To ensure long-term maintainability and respect Clean Code Single Responsibility Principles (SRP):
- **`telemetry-store-helpers.ts`**: Pure calculation routines (`add`, `nowIso`, `sortByDateDesc`, `getEntityScope`, `resolveScope`, `extractUserFeedback`, `computeFinOpsUsage`, `accumulateMetrics`) are isolated into dedicated, testable units.
- **`TelemetryStore`**: Stripped of inline math and multi-pass formatting, focusing strictly on in-memory maps, SQLite synchronization, and approval workflow state machines.

---

## 📊 Summary of Architectural Upgrades

| Feature | Prior to v2.0.0 | AvantGate v2.0.0 |
|---|---|---|
| **Outgoing Idempotency** | Manual, ad-hoc key creation | Standardized causal derivation (`parentRunId ?? runId`) via `getIdempotencyHeaders()` |
| **Server Idempotency** | Required external Redis/database setups | Zero-infra `withServerIdempotency()` with in-memory or `StepStorageAdapter` backends |
| **FinOps Batch Telemetry** | Vulnerable to duplicate metric counting on retry | Automated 24h LRU `batchId` deduplication on GateWall Cockpit |
| **Frontend Frameworks** | React-only `useTask` | Universal `createTaskRunner` + idiomatic React `useTask` |
| **Storage Architecture** | Monolithic 500+ line store class | Decoupled storage engine with separate helper module (`telemetry-store-helpers.ts`) |

---

## 🔄 Migration Guide (v1.9.x ➔ v2.0.0)

AvantGate v2.0.0 is **100% backward-compatible** with v1.9.x applications:
- Existing `useTask` and `useTelemetry` calls continue to function without changes.
- All core AI-WAF guardrails (`AvantGateControlLayer`), PII redaction (`sanitizePII`), and Saga workflows (`createWorkflow`) remain fully compatible.

### Optional Enhancements:
1. **Add Outgoing Idempotency**: Pass `...getIdempotencyHeaders(ctx)` in your `useTask` or agent HTTP requests.
2. **Protect Server Handlers**: Wrap sensitive backend route handlers with `withServerIdempotency()`.

---

## 📦 Verification & Test Suite

AvantGate v2.0.0 passes all automated unit and integration suites:
- **Core SDK & Agents**: 100% pass across AI-WAF, PII sanitization, Saga workflows, tool governance, and idempotency guards.
- **GateWall Cockpit Suite**: 21/21 tests passed (Auth, Zod schemas, browser exporter, retries observability, replay flows, and batch deduplication).

```bash
npm test
# > tsx --test tests/client-telemetry.test.ts tests/ingest-simulation.test.ts tests/retries-and-ttl.test.ts tests/ingest-deduplication.test.ts
# # tests 21
# # pass 21
# # fail 0
```
