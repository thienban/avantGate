# 🗺️ AvantGate Roadmap & Milestones

This document tracks completed milestones and the upcoming architectural roadmap for AvantGate.

---

## 🚀 Shipped Milestones

- ✅ **v1.0 - v1.3: Core In-Process AI-WAF & FinOps**
  - Real-time prompt guardrails (DAN jailbreak, injection, system prompt leak protection).
  - Zero-egress local PII redaction (email, phone, IBAN, French NIR/SPI).
  - Pre-flight token budgeting & Denial-of-Wallet bounds.
  - Multi-model failover & heuristic Zod JSON self-repair.

- ✅ **v1.4: Deterministic Workflow Engine (`avantgate/workflow`)**
  - In-process linear state machine with zero external infrastructure.
  - Automatic reverse Saga rollback ($k-1 \to 0$).
  - Durable Human-in-the-Loop (HITL) checkpoints & `asTool()` conversion.

- ✅ **v1.5: Durable Agent Runtime & Tool Isolation (`avantgate/agent`)**
  - Serverless durable step execution and dual-channel DTO isolation (`llmDto` vs `clientDto`).
  - Pluggable storage adapters (Memory, SQLite, Prisma/PostgreSQL).

- ✅ **v1.6: GateWall Cockpit & Client Telemetry (`avantgate/client`)**
  - Self-hosted visual control plane with SSE live streaming (`gatewall/`).
  - Micro-bundle (< 1.7 KB) client SDK with `fetch(keepalive)` telemetry exporter.

- ✅ **v1.7: Anti-IDOR Defense & Multi-Tenant Enforcement**
  - Compile-time tenant tool scoping (`createTenantTool`).
  - Runtime tenant ownership assertions (`assertTenant`, `assertOwnership`) and RBAC guards.

- ✅ **v1.8: Bidirectional Firewall — Output DLP & Secret Leak Guard**
  - Active detection & redacting of API keys (OpenAI, Anthropic, AWS, GitHub, JWT, Private Keys, DB secrets).
  - In-process bidirectional PII protection extending to LLM completions & audit logs.
  - Configurable `secretLeakAction`: `REDACT` (default) or `BLOCK` (`SecretLeakBlockedError`).

- ✅ **v1.9: Client-Driven In-Context Replay & GateWall Retries Observability**
  - Timeline visibility into retry attempts (`attempts`, `maxRetries`, `retriedErrors`) and first-class session states (`RETRYING`, `RECOVERED`).
  - Zero-infrastructure in-context replay hook (`useTask`) with causal parent linking (`parentRunId`).
  - Fail-closed HITL auto-expiration (24h SLA timeout rejection with real-time SSE propagation).
  - Deterministic HMAC-SHA256 task obfuscation (`deriveOpaqueTaskId`) & scoped Anti-IDOR replay guards.

- ✅ **v2.0: Native Bidirectional Idempotency & FinOps Deduplication Engine**
  - **Outgoing Idempotency (Client ➔ External Providers)**: Automatic causal key propagation via `getIdempotencyKey()` and `getIdempotencyHeaders()` (`Idempotency-Key: ctx.parentRunId ?? ctx.runId`).
  - **Incoming Idempotency (Client ➔ Host Server)**: In-process server-side guard `withServerIdempotency()` with pluggable memory and `StepStorageAdapter` backends.
  - **GateWall FinOps Deduplication**: LRU 24h `batchId` idempotency cache on `/api/v1/ingest/events` preventing double-counting of tokens and inference costs upon network retries.
  - **Storage Architecture Hardening**: Modularization of telemetry storage into dedicated, decoupled helpers (`telemetry-store-helpers.ts`) adhering to Clean Code SRP.

- ✅ **v2.1: Headless UI Canvas Submodule (`avantgate/ui`) & React Presentation Plane (`avantgate/ui/react`)**
  - **Canonical Tool Envelope Protocol (`ToolExecutionEnvelope`)**: Standardized contract carrying merge strategies (`REPLACE`, `APPEND_UNIQUE`, `UPDATE_ENTITY`) and visual intentions (`UIIntent`).
  - **Deterministic Concurrency Reducer (`createCanvasReducer`)**: $O(N)$ Set-based algebraic convergence resolving parallel tool calling race conditions and out-of-order responses without state loss.
  - **End-to-End Typed Application Factory (`defineCanvas`)**: Connects client canvas schemas to typed envelopes and reducer in a single line.
  - **React View Registry (`createViewRegistry`)**: Instant $O(1)$ polymorphic component dispatch with `React.createElement` (zero JSX runtime lock-in, native compatibility with shadcn/ui and Tailwind).
  - **Native Anti-XSS Sanitizer Guard (`isValidSafeUrl`)**: WHATWG standard URL scanner neutralizing `javascript:`, `data:`, and protocol-relative (`//evil.com`) redirect vectors without external dependencies.
  - **Zero-Dependency Supply-Chain Architecture**: Ultra-compact footprint (< 2.5 KB minified), 0 new runtime dependencies, and optional React peer dependency.

---

## 🔮 Upcoming Milestones

### 1. 🏷️ Custom Redaction Terms & GateWall Manager
- User-defined proprietary dictionary to mask project codenames, enterprise names, and internal hosts.
- Embedded SQLite persistence (`custom_terms`) and visual cockpit management in GateWall.

### 2. 🔌 Lifecycle Middleware Hooks (`beforeRequest`, `afterResponse`)
- Lightweight, extensible middleware hooks allowing custom inspection, context injection, or response transformation without forking core logic.
- Native integration point for custom enterprise RAG pipelines, external tokenizers, and custom threat detectors.

### 3. 🚀 Launch-Safe Presets (`PRESETS.LAUNCH_SAFE`)
- Zero-config, hardened presets offering sensible defaults for production environments (strict prompt injection checks, PII redaction, token budgets, and multi-model failover).
- One-line instantiation: `new AvantGateControlLayer(PRESETS.LAUNCH_SAFE)`.

