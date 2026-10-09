# 🚀 AvantGate v2.4.0 — Release Notes

> **Release Date**: October 8, 2026  
> **NPM Package**: [`avantgate@2.4.0`](https://www.npmjs.com/package/avantgate)  
> **Release Type**: Major Feature & Resiliency Release — Pessimistic FinOps Reservations, Stream-First Dynamic Timeouts, Agent Tool Call Resilience (Outbox Intent Claim Protocol) & Lifecycle Middleware Security Hardening (Context Immutability, Strict Schema, Anti-IPI RAG & Timeout DoS).

---

## 📌 Executive Summary

Autonomous AI agents and LLM production pipelines face three critical vulnerabilities in distributed production environments:

1. **The Phantom FinOps Window**: When an LLM provider request times out or suffers a socket drop, the client receives a network error while the upstream provider may continue generating tokens and billing the organization. Blindly retrying without accounting for worst-case financial liabilities leads to catastrophic budget overruns.
2. **The Phantom Mutation Hazard**: When an autonomous agent triggers a mutative external tool (e.g. credit card charge on Stripe, database mutation, email dispatch) and the socket drops before receiving the HTTP response, the autonomous agent perceives a failure and hallucinates an immediate retry at turn $N+1$. Without intent locks, this causes double charges, duplicate records, and out-of-control side-effects.
3. **The Hostile Middleware & In-Place State Poisoning Blindspot**: When custom or third-party middleware hooks augment prompts (such as injecting external RAG document snippets), naive shallow freezing allows in-place state corruption. Furthermore, uninspected RAG documents can introduce Indirect Prompt Injections (IPI), schema pollution, or freeze the entire event loop without unit timeouts.

**AvantGate v2.4.0 eliminates all three hazards at the engine level while remaining 100% headless, in-process, and strictly zero-dependency.**

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              AVANTGATE v2.4.0 ARCHITECTURE                             │
│                                                                                        │
│  1. Pessimistic FinOps Budget Reservations                                             │
│     • In-Process State Machine: RESERVED -> SETTLED | UNCONFIRMED_TIMEOUT | RELEASED   │
│     • Cumulative Worst-Case Solvency: Guarantees solvent retries on ambiguous drops    │
│     • FIFO Bounded Memory Store: O(1) leak-free budget tracking (10,000 max entries)   │
│                                                                                        │
│  2. Transport Stream-First & TTFT Heartbeat                                            │
│     • Dynamic Time-to-First-Token (15s) and Idle Read Heartbeat (5s)                   │
│     • Eliminates premature socket drops on massive, long-running LLM stream responses  │
│     • ProviderTTFTTimeoutError & ProviderIdleTimeoutError for deterministic failover   │
│                                                                                        │
│  3. Agent Tool Call Resilience & Outbox Intent Claim Protocol                          │
│     • Intent Claim Protocol: Pre-execution atomic state locking (STATUS: CLAIMED)      │
│     • Anti-Double Mutation Barrier: Re-execution of MUTATIVE/DESTRUCTIVE tools blocked │
│     • Static Idempotency Short-Circuit: Cached instant return on identical toolCallId  │
│     • Declarative Read-Before-Write Reconciliation: onAmbiguousRetry handler           │
│     • Human-in-the-Loop Escalation: Automatic StepSuspendedError on ambiguous states   │
│                                                                                        │
│  4. Lifecycle Middleware Security Hardening                                            │
│     • Canonical Deep Freeze Standard: WeakSet circular guard & bounded maxDepth (10)   │
│     • Strict Runtime Schema: ChatMessageSchema.strict() blocks prototype pollution     │
│     • Post-Middleware Anti-IPI Re-Scan: Zero-overhead inspection of injected RAG items │
│     • Per-Middleware Timeout Guard: Promise.race with MiddlewareTimeoutError           │
│                                                                                        │
│  5. Zero-Infra & In-Process Core (Zero External Dependencies)                          │
│     • 100% pure TypeScript, Arrow Functions exclusively, strict SRP (<= 20 lines/fn)   │
│     • 100% passing tests across all suites (core, agent, workflow, client, UI)         │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🌟 Key Highlights of v2.4.0

### 1. 🛡️ Pessimistic FinOps Reservations & Cumulative Solvency (FEAT-030)

AvantGate v2.4.0 introduces an in-process reservation lifecycle protecting applications from invisible financial liabilities during network disconnects:

- **Reservation Lifecycle**:
  - `RESERVED`: Maximum worst-case budget reserved pre-flight.
  - `SETTLED`: Actual token usage and USD cost committed after successful response; unused reserve released.
  - `UNCONFIRMED_TIMEOUT`: Preserved against total budget when a socket drop or ambiguous timeout occurs against non-idempotent providers.
  - `RELEASED`: Returned to pool on deterministic client rejection (4xx).
- **Cumulative Solvency on Retries**:
  - When retrying after an ambiguous timeout, AvantGate enforces solvency against the **cumulative worst-case cost** (Reservation $1$ + Reservation $2$) rather than assuming the first call was free.
- **Bounded In-Memory Capacity**:
  - FIFO auto-pruning (`MAX_RESERVATIONS = 10000`) prevents memory leaks in high-throughput environments without external databases or Redis.

```typescript
import { createAvantGate } from "avantgate";

const gate = createAvantGate({
  primary: { provider: "openai", model: "gpt-4o", apiKey: process.env.OPENAI_API_KEY! },
  maxCostUSD: 1.00,
  maxTokenBudget: 4096,
  pessimisticBudgetReservation: true, // Auto-tracks worst-case hold during execution
});
```

---

### 2. ⚡ Transport Stream-First & TTFT Heartbeat (FEAT-030)

Traditional HTTP clients apply static timeouts (e.g. 30s) across the entire generation lifecycle, prematurely killing long reasoning models (o1, DeepSeek-R1) or multi-thousand token outputs.

`HttpProviderClient` now implements dynamic heartbeat streaming:
- **Time-to-First-Token (`ttftTimeoutMs`, default 15s)**: Aborts fast if the provider fails to emit the first byte.
- **Idle Read Timeout (`idleTimeoutMs`, default 5s)**: Once streaming begins, keeps the connection alive indefinitely as long as chunks arrive within the heartbeat window.
- **Dedicated Domain Errors**: Emits `ProviderTTFTTimeoutError` or `ProviderIdleTimeoutError` allowing failover orchestrators to cleanly distinguish cold-start hangs from stalled generations.

---

### 3. 🛑 Agent Tool Call Resilience & Outbox Intent Claim (FEAT-031)

To prevent autonomous agents from repeating mutations upon timeout, AvantGate v2.4.0 brings the **Outbox Intent Claim Protocol** to agent tools:

#### A. Verrou d'Intention Atomique (`STATUS: CLAIMED`)
Before issuing any network mutation, `withToolResilience` records a claim in `StepStorageAdapter`.

#### B. Anti-Phantom Mutation Barrier
If a tool declared as `MUTATIVE` or `DESTRUCTIVE` experiences a socket drop or timeout:
1. The execution state is sealed as `UNCONFIRMED_TIMEOUT`.
2. Any subsequent retry from the agent with the same `toolCallId` is **blocked immediately**.
3. Zero network calls are dispatched without explicit reconciliation.

#### C. Réconciliation Déclarative (*Read-Before-Write*)
Tools define an `onAmbiguousRetry` callback to check if the mutation was committed before deciding:

```typescript
import { createIsolatedTool } from "avantgate/agent";

export const refundOrderTool = createIsolatedTool({
  name: "refund_order",
  impact: "MUTATIVE",
  resilience: {
    timeoutMs: 15000,
    suspendOnAmbiguous: true, // Elevates to Human-in-the-Loop if unreconciled
    onAmbiguousRetry: async ({ toolCallId, args }) => {
      // Check existing refund in Stripe before committing a second charge
      const existing = await stripe.refunds.list({ charge: args.chargeId });
      const match = existing.data.find((r) => r.metadata.toolCallId === toolCallId);
      return match ? { reconciled: true, result: match } : { reconciled: false };
    },
  },
  execute: async (args, ctx) => {
    return stripe.refunds.create({
      charge: args.chargeId,
      amount: args.amount,
      metadata: { toolCallId: ctx.toolCallId },
    }, {
      idempotencyKey: ctx.idempotencyKey, // Auto-injected by AvantGate
    });
  },
});
```

#### D. Human-in-the-Loop (HITL) Suspension
When reconciliation fails (`{ reconciled: false }`), AvantGate automatically throws `StepSuspendedError`, pausing the agent workflow until human approval is granted in the console.

---

### 4. 🔒 Lifecycle Middleware Security Hardening (FEAT-036)

Following a comprehensive security architecture review, AvantGate v2.4.0 introduces a defense-in-depth security boundary for custom lifecycle middlewares:

#### A. Canonical Deep Freeze Immutability Standard (`src/utils/immutability.ts`)
- Replaces naive shallow freezes with `deepFreeze<T>(target, options?)`.
- **Anti-Circular Reference Protection**: Uses a native `WeakSet` to detect cyclic structures (`obj.self = obj`) without blowing the call stack (`Maximum call stack size exceeded`).
- **DoS Bounded Depth**: Limits traversal depth (`maxDepth: 10`) to mitigate algorithmic complexity attacks.
- **Special Objects Safe**: Safely preserves `Date`, `RegExp`, and `Promise` instances.

#### B. Strict Runtime Schema Enforcement (`ChatMessageSchema.strict()`)
- Eliminates compile-time-only type blindspots.
- Uses Zod `.strict()` to immediately reject unauthorized roles, non-string contents, and prototype pollution attempts (`__proto__`, hidden properties).
- Fails closed with `InvalidMessageSchemaError`.

#### C. Post-Middleware Anti-IPI Re-Scanning (`reScanIngressAfterHooks`)
- Whenever a middleware modifies or injects messages (e.g. dynamic RAG excerpts), AvantGate automatically re-scans the newly introduced items against prompt injection and jailbreak patterns.
- Raises `PromptInjectionError` before hostile content can reach the provider.
- Operates with **zero overhead** when message contents remain unchanged.

#### D. Per-Middleware Timeout Guard (`middlewareTimeoutMs`)
- Prevents rogue or stalled middlewares from freezing the entire Node.js event loop.
- Wraps every execution in a `Promise.race` against a dedicated timer (default `5000ms`, `3000ms` in `ENTERPRISE_STRICT`).
- Raises `MiddlewareTimeoutError` identifying the culprit middleware.

```typescript
import { createAvantGate, PRESETS } from "avantgate";

// Production-hardened with Launch-Safe preset
const gate = createAvantGate(
  PRESETS.LAUNCH_SAFE({
    primary: { provider: "openai", model: "gpt-4o" },
    middlewares: [myCustomRagMiddleware],
    middlewareTimeoutMs: 3000,
    reScanIngressAfterHooks: true,
  })
);
```

---

## 🧪 Quality & Verification

- **100% Pass Rate**: Full test coverage across the entire test suite:
  - `tests/finops/pessimistic-budget.test.ts` (Worst-case reservation holds, solvency blocking, release lifecycle).
  - `tests/providers/stream-timeout.test.ts` (TTFT timeouts, long stream generation, idle drop detection).
  - `tests/agent/tool-resilience.test.ts` (Nominal runs, idempotency caching, ambiguous timeouts, anti-double mutation blocking, reconciliation, HITL suspension, READ_ONLY re-execution).
  - `tests/utils/immutability.test.ts` (Canonical `deepFreeze`, circular reference protection via WeakSet, bounded depth DoS protection, native objects).
  - `tests/middleware-lifecycle.test.ts` (Deep immutability, strict schema validation, post-RAG IPI detection, per-middleware timeout interrupts).
  - All existing agent, saga workflow, client, and UI suites.
- **Strict Clean Code Standards**:
  - Maximum 20 lines per function.
  - Arrow functions exclusively, named exports, early returns.
  - Zero external npm runtime dependencies.
- **Type Safety**: Full TypeScript declaration generation (`.d.ts`), verified with `npm run lint` (`tsc --noEmit`) and `npm run build`.

---

## 📦 Newly Exported Primitives & Errors

| Export | Type | Description |
|---|---|---|
| `deepFreeze<T>` | Function | Canonical deep freeze helper with WeakSet circular guard & maxDepth |
| `ChatMessageSchema` | Zod Schema | Strict runtime validator for chat message objects |
| `ChatMessagesArraySchema` | Zod Schema | Strict array validator for chat message arrays |
| `ChatRoleSchema` | Zod Schema | Strict enum validator for message roles (`system`, `user`, `assistant`, `tool`) |
| `MiddlewareTimeoutError` | Error Class | Thrown when a middleware hook exceeds `middlewareTimeoutMs` |
| `InvalidMessageSchemaError` | Error Class | Thrown when a middleware returns payload failing `ChatMessageSchema.strict()` |
| `PromptInjectionError` | Error Class | Thrown when an ingress prompt or injected RAG snippet contains a prompt injection |
| `ProviderTTFTTimeoutError` | Error Class | Thrown when initial stream byte exceeds time-to-first-token threshold |
| `ProviderIdleTimeoutError` | Error Class | Thrown when active stream stalls beyond idle heartbeat threshold |
| `StepSuspendedError` | Error Class | Thrown on unconfirmed ambiguous mutation to escalate to Human-in-the-Loop |

---

## 📦 Upgrade Guide

To upgrade your project to v2.4.0:

```bash
npm install avantgate@2.4.0
```

*This release is 100% backwards-compatible with all existing `avantgate` v2.x workflows, middlewares, and tool configurations.*
