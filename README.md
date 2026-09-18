# 🛡️ AvantGate (`avantgate`)

> **The Zero-Infrastructure, In-Process LLM Control Plane for TypeScript.**  
> Real-time cost control, token budgets, PII redaction, prompt guardrails, and multi-model failover **without hosting Docker, PostgreSQL, ClickHouse, or Redis.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Zod Native](https://img.shields.io/badge/Schema-Zod%20Native-orange)](https://zod.dev/)
[![Zero Infra](https://img.shields.io/badge/Infrastructure-Zero%20Servers-emerald)](#why-avantgate)

---

## ⚡ Why AvantGate? (The Problem with Heavy Observability)

Traditional LLM observability stacks like **Langfuse**, **Helicone**, or **LangSmith** are great, but for 90% of production apps, self-hosting them is a nightmare:
- ❌ **Heavy Infrastructure**: Requires spinning up Next.js + PostgreSQL + ClickHouse + Redis + S3.
- ❌ **VPS & Cloud Costs**: $30 to $100+/month just to monitor API calls.
- ❌ **Passive / Post-Mortem**: They log errors and costs *after* you have already paid for the wasted tokens.
- ❌ **Egress Latency & Privacy**: Sends user prompts over external HTTP networks.

### 🛡️ The AvantGate Philosophy: Active In-Process Control
**AvantGate runs entirely inside your existing application process.** No external containers, no database required, no network latency.

```mermaid
flowchart LR
    App[Your Application] --> InputGuard[🛡️ Input & PII Guard]
    InputGuard --> TokenBudget[💰 Token Budget Guard]
    TokenBudget --> FallbackRouter[🔀 Fallback Router]
    FallbackRouter --> Providers["LLM Providers (DeepSeek / Mistral / Ollama)"]
    Providers --> JSONRepair[🔧 Zod JSON Self-Repair]
    JSONRepair --> Audit[📊 Local Cost Ledger & Telemetry]
```

---

## ☁️ GateWall Platform — Enterprise AI-WAF & Corporate DLP *(Coming Soon)*

While the open-source **AvantGate SDK** provides lightweight, in-process control and PII redaction, **GateWall Platform** is the enterprise AI Application Firewall (AI-WAF) and Corporate DLP gateway engineered for regulated industries (Fintech, Banking, Legaltech, and Listed Scale-ups).

Available as a **Managed Cloud Control Plane** or an **Out-of-Process High-Availability Sidecar/Proxy**:

> 🚀 **Interested in private preview, enterprise VPC, or On-Premise deployment?** Contact our team at [contact@gatewall.fr](mailto:contact@gatewall.fr) for early access.

---

## 🚀 Key Features

- 💰 **Pre-Flight Token Budgeting**: Rejects or truncates requests exceeding budget *before* invoking external APIs.
- 🏷️ **Real-Time Cost Ledger**: Exact cent-level cost tracking calculated instantly across models (DeepSeek, Mistral, OpenAI, Anthropic, OpenRouter, and $0 local Ollama).
- 🛡️ **Active Security & PII Redaction**: In-flight masking of emails, phone numbers, and French/EU identifiers before sending to cloud providers. Blocks prompt injection & jailbreaks.
- 🔀 **Zero-Downtime Multi-Model Failover**: If DeepSeek or Mistral returns HTTP 429/500, seamlessly failover to a backup provider (or local Ollama) in milliseconds.
- 🔧 **Self-Repairing Structured Outputs**: Strict Zod runtime validation with automated markdown/JSON repair if the LLM hallucinates formatting.
- 🤖 **Durable Agent Harness & PII Shield (`avantgate/agent`)**: Serverless memoized step execution (`step.run()`), native Human-in-the-Loop approval (`step.waitForApproval()`), and Dual-Channel tool data isolation without Temporal or Redis.
- 📡 **Zero-Dependency Telemetry Bridge (`HttpTelemetryExporter`, `PlatformStorageAdapter`)**: Mirror in-process executions and hierarchical tool traces asynchronously to any HTTP sink or observability endpoint with $0 external npm dependencies.
- 📦 **100% Framework Agnostic**: Works in Next.js, Express, Fastify, NestJS, Cloudflare Workers, AWS Lambda, or CLI scripts.

---

## 📊 Comparison: Langfuse vs. AvantGate

| Capability | Langfuse (Self-Hosted) | AvantGate (`avantgate`) |
|---|:---:|:---:|
| **Infrastructure Required** | Docker + Postgres + ClickHouse + Redis | **Zero Infrastructure** (Pure npm package) |
| **Hosting Cost** | $30 - $100 / month | **$0 / month** (Runs inside your app) |
| **Token Budget Enforcement** | ❌ Passive logging only | ✅ **Active Pre-Flight Guard** (Blocks before spending) |
| **In-Flight PII Redaction** | ❌ Logs all raw data | ✅ **Automatic local masking** before API dispatch |
| **Multi-Provider Failover** | ❌ No | ✅ **Built-in Fallback Router & Exponential Retry** |
| **Zod Schema Auto-Repair** | ❌ No | ✅ **Built-in JSON Heuristic Repair** |
| **Durable Workflow & HITL** | Requires Temporal / Inngest | ✅ **Built-in In-Process Step Runner & HITL** |
| **Tool PII & Dual-Channel** | ❌ No | ✅ **Built-in `createIsolatedTool`** |
| **Telemetry Network Latency** | ❌ +50ms - 200ms per trace call | ✅ **0 ms** (In-process memory accounting) |
| **Central Web Dashboard** | Heavy self-hosted web app | ✅ **Optional Remote Sink** (Plug any HTTP endpoint via `PlatformStorageAdapter`) |
| **Hierarchical Session Replay** | ❌ Flat span waterfall | ✅ **Causality Tree + Dual-Channel Isolation** |

---

## 📦 Installation

```bash
npm install avantgate zod
# or
pnpm add avantgate zod
# or
yarn add avantgate zod
```

### 🧩 Subpath Exports

| Import Path | Description |
|---|---|
| `avantgate` | Core control plane: token budgets, cost ledger, prompt guards, multi-model failover & Zod repair. |
| `avantgate/finance` | Financial data normalizer (accounting parentheses, EU/US/UK/CH currencies & magnitudes). |
| `avantgate/agent` | *(Preview / Experimental)* Durable step runner, Human-in-the-Loop, dual-channel PII tool isolation & storage adapters. |

---

## 📖 Documentation & Guides

Comprehensive guides, copy-pasteable integration recipes, and architectural references are available in the dedicated documentation:

| Guide | Description |
|---|---|
| **[Code Examples & Recipes](docs/examples.md)** | Full walkthroughs for cost tracking, Zod self-repair, multi-model failover, PII masking, pre-flight budgets, and the prompt engine. |
| **[Decoupled Pricing & DB Adapters](docs/pricing.md)** | Dynamic token pricing, database integration (Prisma / PostgreSQL / Drizzle), in-memory TTL caching, and runtime overrides. |
| **[Durable Agent Harness & Tool Isolation](docs/agent.md)** | Serverless durable step execution, Human-in-the-Loop suspension, dual-channel DTO tool isolation, and telemetry streaming. |

---

## 🏗️ Architecture & Extensibility

AvantGate is built around clean **Ports and Adapters**:

- **`LLMProviderPort`**: Abstract interface allowing you to plug any custom provider (Azure OpenAI, Bedrock, vLLM).
- **`AuditSinkPort`**: Pluggable telemetry sink. Export metrics to `console`, local SQLite, or OpenTelemetry with zero overhead.

---

## 🗺️ Roadmap & Milestones

### 🎯 Core Control Plane (`avantgate`)

1. ⏱️ **In-Process Sliding-Window Rate Limiter & User Quotas**
   - In-memory token bucket per User ID, IP address, or session without Redis.
   - Per-user daily & hourly token budget limits with automatic graceful throttling.

2. 🔒 **Bidirectional Sanitizer & Secret Leak Prevention**
   - Extend PII protection from input queries to **model outputs and audit logs**.
   - Active inspection to prevent LLM hallucinations from leaking server credentials, environment variables (`sk-...`, JWTs), or raw system instructions to client frontends.

3. ⚡ **Spend Velocity Circuit Breaker & Exponential Backoff**
   - Real-time spend velocity detection (trips if spend exceeds $X within Y minutes).
   - Configurable exponential backoff retries before triggering provider failover.
   - Safe degradation returning user-friendly messages instead of raw provider crashes.

4. ⚖️ **Real-Time Evaluation Quality Gates**
   - Replace gut-feel and vibe-based evaluations with in-process, measurable output quality gates.
   - Built-in sub-millisecond heuristic gates:
     - **Refusal & Boilerplate Gate**: Detects unwanted refusal phrasing (*"As an AI..."*) and triggers fallback.
     - **Context Grounding Gate**: Verifies factual entity containment against supplied reference text.
   - Automated corrective retry loop (`onFailure: "retry_with_feedback"`) or instant model failover.

5. 🔌 **Lifecycle Middleware Hooks (`beforeRequest`, `afterResponse`)**
   - Extensible middleware pipeline to inspect, enrich, or modify prompts and completions without modifying core logic.
   - Universal hook allowing any external RAG system or context engine to compose with AvantGate seamlessly.

6. 🚀 **One-Line Launch-Safe Presets (`PRESETS.LAUNCH_SAFE`)**
   - Zero-config hardened setup with sensible defaults for security, budgets, and failovers.

### 📦 Modular Ecosystem & Extensions

- **`avantgate/agent`**: Zero-infra durable step orchestration, human-in-the-loop pauses, and dual-channel PII tool isolation.
- **`avantgate/finance`**: Zero-overhead financial accounting normalizer across international jurisdictions (FR PCG, US GAAP, UK IFRS, Swiss CO).
- **Launch Readiness Linter**: Standalone developer tool to audit codebases before launch for exposed keys, unbudgeted endpoints, and missing guards.

---

## 🤝 Contributing

Contributions are welcome! Please read our [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

```bash
git clone https://github.com/your-org/avantgate.git
cd avantgate
npm install
npm test
```

---

## 🙏 Acknowledgements & Credits

AvantGate builds upon foundational ideas and inspirations from the open source AI engineering and durable execution communities:

### 🛡️ In-Process Control & Production Layers
- Special credit to [**Emmimal/control-layer**](https://github.com/Emmimal/control-layer) for pioneering the in-process control layer architecture.
- Valuable insights and launch safety principles inspired by [**ShipYourAI.com**](https://shipyourai.com).
- **[context-engine](https://github.com/Emmimal/context-engine)** — Retrieval, re-ranking, memory decay, and token budget control for RAG systems. *The control layer handles what the model returns. The context engine handles what it receives. They compose.*
- **[RAG Is Blind to Time — Temporal Layer](https://github.com/Emmimal/temporal-layer)** — Temporal awareness layer for RAG systems that treats time as a first-class retrieval signal.
- **[LLM Evals Are Based on Vibes — Evaluation Layer](https://github.com/Emmimal/eval-layer)** — Evaluation layer that replaces gut-feel shipping decisions with measurable output quality gates.
- **[PyTorch NaNs Are Silent Killers — NaN Catch Hook](https://github.com/Emmimal/nan-hook)** — Lightweight hook that catches NaN propagation at the exact layer it originates, in under 3ms overhead.

### 📊 FinOps & Observability Platforms
- **[Helicone](https://github.com/Helicone/helicone)** — Pioneering LLM request caching, granular cost estimation, and developer-first proxy design that inspired our FinOps engine and semantic tool caching patterns.
- **[AgentOps](https://github.com/AgentOps-AI/agentops)** — State-of-the-art agent tracking, session replay visualization, and recursive loop detection that inspired our Session Replay and Infinite Loop Shield.

### 🤖 Durable Workflows & Agent Architecture (`avantgate/agent`)
- **[Inngest](https://www.inngest.com)** & **[Temporal](https://temporal.io)** — The developer experience of durable step memoization (`step.run()`) and human validation pauses (`step.waitForApproval()`), reimagined here as a **$0-infrastructure, serverless in-process harness** without requiring external worker queues or Redis clusters.
- **[Vercel AI SDK (`ai`)](https://sdk.vercel.ai)** — Standardized TypeScript tool schema contracts (`parameters`, `execute`) natively embraced and augmented by `createIsolatedTool`.
- **Least-Privilege & Dual-Channel Isolation** — Security patterns separating sensitive payload data (streamed out-of-band directly to trusted user interfaces) from LLM prompts (receiving sanitized summaries), preventing context pollution and PII leakage.
- **Alistair Cockburn's Ports & Adapters (Hexagonal Architecture)** — Pure domain isolation enabling developers to plug any database (Prisma, SQLite, Drizzle, Kysely, Mongo, Redis) with zero hard framework dependencies.

---

## 📜 License

MIT License © 2026 AvantGate Contributors. Built with pride for developers who value performance, simplicity, and zero-infra architecture.

