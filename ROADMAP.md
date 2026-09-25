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

---

## 🔮 Upcoming Milestones

### 1. 🏷️ Custom Redaction Terms & GateWall Manager ([FEAT-022](tickets/FEAT-022-custom-redaction-terms-and-gatewall-manager.md))
- User-defined proprietary dictionary to mask project codenames, enterprise names, and internal hosts.
- Embedded SQLite persistence (`custom_terms`) and visual cockpit management in GateWall.

### 2. 🔌 Lifecycle Middleware Hooks (`beforeRequest`, `afterResponse`)
- Lightweight, extensible middleware hooks allowing custom inspection, context injection, or response transformation without forking core logic.
- Native integration point for custom enterprise RAG pipelines, external tokenizers, and custom threat detectors.

### 3. 🚀 Launch-Safe Presets (`PRESETS.LAUNCH_SAFE`)
- Zero-config, hardened presets offering sensible defaults for production environments (strict prompt injection checks, PII redaction, token budgets, and multi-model failover).
- One-line instantiation: `new AvantGateControlLayer(PRESETS.LAUNCH_SAFE)`.

