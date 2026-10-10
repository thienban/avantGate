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
- ✅ **v2.2: Custom Redaction Terms, GateWall Manager & Hexagonal Storage Engine**
  - **In-Flight Bidirectional Masking (`sanitizeCustomTerms`)**: Zero-dependency word boundary regex redaction preserving subwords ("Art" vs "partout") and descending length precedence.
  - **Category Defaults**: Automatic mask suggestions (`[REDACTED_PROJECT]`, `[REDACTED_COMPANY]`, `[REDACTED_INFRA]`, `[REDACTED_CUSTOM]`).
  - **GateWall Cockpit UI**: Interactive manager component (`CustomTermsManager.tsx`) with category badges, 1-click delete, and direct synchronization.
  - **Hexagonal Storage Architecture (`StoragePort`)**: Clean separation of Domain services from database infrastructure with pluggable `SqliteStorageAdapter` (Node 22 zero-dep), `MemoryStorageAdapter` (zero-disk CI testing), and `PrismaStorageAdapter` (PostgreSQL / Supabase / AWS RDS enterprise ready).
  - *Full details: [v2.2.0 Release Notes](docs/release/release-2.2.0.md)*

- ✅ **v2.3: Lifecycle Middleware Hooks & Hardened Launch-Safe Presets**
  - **Extensible Interceptor Pipeline**: Pure TypeScript in-process middlewares (`AvantGateMiddleware`) chaining deterministic `beforeRequest` and `afterResponse` hooks.
  - **Short-Circuit / Cache Sémantique**: Interception avant appel LLM (`shortCircuit`) bypassant le provider et le budget avec 0 token, 0 coût, tout en garantissant le passage dans les filtres DLP/secrets.
  - **Injection RAG & Contexte Dynamique**: Modification en vol du tableau de messages (`messages`) avant vérification de budget et dispatch.
  - **Post-Traitement & Watermarking**: Transformation contrôlée du texte de réponse avant audit et sortie sécurisée.
  - **Zero-Config Launch-Safe Presets (`PRESETS.LAUNCH_SAFE`, `PRESETS.ENTERPRISE_STRICT`)**: One-line hardened instantiation for production AI firewalls with deep overrides support.

- ✅ **v2.4: Pessimistic FinOps, Agent Tool Call Resilience & Middleware Security Hardening**
  - **Pessimistic FinOps Reservations (FEAT-030)**: In-process budget reservation lifecycle (`RESERVED`, `SETTLED`, `UNCONFIRMED_TIMEOUT`, `RELEASED`) with cumulative solvency enforcement on ambiguous retries.
  - **Transport Stream-First & TTFT Heartbeat (FEAT-030)**: Dynamic Time-to-First-Token (15s) and idle read timeouts (5s) in `HttpProviderClient` preventing premature socket drops on long generations.
  - **Intent Claim Protocol (FEAT-031)**: Pre-execution atomic state locking (`STATUS: CLAIMED`) in `StepStorageAdapter` preventing blind multi-execution in-process.
  - **Anti-Double Mutation Barrier (FEAT-031)**: Automatically intercepts ambiguous timeouts on `MUTATIVE` & `DESTRUCTIVE` tools to prevent autonomous agents from re-firing duplicate external mutations.
  - **Declarative Reconciliation & HITL (FEAT-031)**: Pluggable `onAmbiguousRetry` routines (read-before-write checks) and `StepSuspendedError` / `AmbiguousToolExecutionError` handling.
  - **Canonical Deep Freeze Immutability (FEAT-036)**: Zero-dependency recursive `deepFreeze` helper with native `WeakSet` circular reference guard and bounded `maxDepth: 10` in `src/utils/immutability.ts`.
  - **Strict Runtime Schema Enforcement (FEAT-036)**: Elimination of compile-time-only blindspots via `ChatMessageSchema.strict()` and `InvalidMessageSchemaError` blocking prototype pollution and illegal roles.
  - **RAG Anti-IPI Re-Scan (FEAT-036)**: Zero-overhead post-hook inspection of added or modified messages (`reScanIngressAfterHooks`) blocking Indirect Prompt Injections with `PromptInjectionError`.
  - **Bounded Middleware Timeouts (FEAT-036)**: Unitary timeout guard (`middlewareTimeoutMs`) and `MiddlewareTimeoutError` via `Promise.race` preventing pipeline DoS from hung middleware calls.
  - *Full details: [v2.4.0 Release Notes](docs/release/release-2.4.0.md)*

- ✅ **v2.5: In-Flight Bidirectional DLP & Arithmetic Modulo 97 Engine**
  - **In-Flight Bidirectional DLP (`InFlightRedactionSession` / `BidirectionalSanitizer`)**: Reversible, ephemeral redaction for ingress prompts and egress JSON responses with signed, collision-proof tokens (`⟪AG:TYPE:INDEX:SALT⟫`).
  - **Ephemeral Cryptographic Salt**: Zero-collision guarantee per session via `crypto.getRandomValues` preventing token injection.
  - **Entity Referent Reuse**: Deterministic identity preservation across turns for identical PII entities.
  - **Streaming SSE Sliding Buffer**: W3C `TransformStream<string, string>` reconstituting fragmented tokens across chunk boundaries on-the-fly without stalling stream latency.
  - **Arithmetic $O(1)$ ISO 7064 & NIR Checksums**: Native `BigInt` Modulo 97-10 verification for IBAN and official INSEE validation for French NIR Social Security numbers (Corsica 2A/2B support).
  - **Zero-Retention Memory Purge**: Immediate RAM clearance via `session.dispose()` and TypeScript 5.2+ `[Symbol.dispose]()` (`using session = ...`).
  - *Full details: [v2.5.0 Release Notes](docs/release/release-2.5.0.md)*

---

## 🔮 Upcoming Milestones

### 1. 🌐 AvantGate Secure Gateway & Smart Router (v2.5 SaaS MVP "Secure OpenRouter")
- **Universal `/v1/chat/completions` Drop-in Endpoint**: 100% OpenAI SDK, Vercel AI SDK and curl compatible HTTP proxy supporting native Server-Sent Events (`text/event-stream`) and standard JSON responses.
- **Master Multi-Provider Dispatch & Auto-Fallback**: Zero-latency switching across OpenAI, Anthropic, and Mistral AI (EU sovereign) with automatic failover (< 500 ms) upon upstream 5xx or provider timeouts.
- **In-Flight Privacy & Injection Shield**: Dual-pass PII masking and unmasking in-flight (IBAN, NIR, emails, phone), bidirectional Secret DLP, and Prompt Injection neutralization with zero egress of sensitive raw data.
- **Single Client Key Auth & BYOK Master Vault**: Client-facing unique API key authentication (`ag_live_...`) with timing-safe SHA-256 hashing and AES-256-GCM encrypted provider credentials storage.
- **GateWall SaaS Console (Next.js App Router & shadcn/ui)**: Developer dashboard for instant API key issuance, live SSE request logs, PII redaction audit trails, and token FinOps monitoring.

### 2. 💎 Enterprise Distributed FinOps & Gateway Orchestrated Resilience (v2.6 Enterprise SaaS)
- **Distributed Hold Manager**: Multi-worker & multi-container pessimistic quota locking with Redis / PostgreSQL distributed transactions.
- **Dynamic FinOps Router (`avantgate/auto`)**: Automated prompt complexity classifier routing basic prompts to cost-efficient models (`gpt-4o-mini`, `mistral-small`).
- **Cluster-Wide Idempotency Outbox**: Distributed claims preventing concurrent container execution across external services (Stripe, HubSpot, ERP).
- **Web HITL Cockpit & Multi-Channel Escalation**: Visual suspended actions board on GateWall dashboard with one-click manager approval/rejection, real-time TTL auto-expiration, and Slack / Webhook notifications.