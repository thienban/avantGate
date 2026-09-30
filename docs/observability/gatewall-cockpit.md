# 🖥️ GateWall Cockpit — Self-Hosted Governance Console (`gatewall/`)

GateWall Cockpit is an embedded, self-hosted Next.js control plane that connects directly to the AvantGate runtime. It provides visual audit logging, real-time Human-in-the-Loop approval queues, and FinOps pricing administration.

---

## 🚀 Quickstart

Run with Docker Compose:
```bash
docker compose up -d
# or: npm run gatewall:docker
```
Access the console at **`http://localhost:3000`**.

---

## ⚡ Core Cockpit Views

| View | Path | Description |
|---|---|---|
| **Dashboard** | `/` | Real-time spend, token counters, alerts, active tools, and recent activity. |
| **Sessions & Action Replay** | `/sessions` | Step-by-step causal timeline tracing all agent actions, tool executions, latency, and costs. |
| **HITL Approval Queue** | `/approvals` | Review and click **Approve** or **Reject** on suspended tools and sensitive actions. |
| **Dual-Pass Inspector** | `/firewall` / `/security` | Compare masked PII summaries (`llmSummary`) vs local escrow (`rawPayload`). |
| **FinOps Administration** | `/pricing` | Add, edit, and seed LLM model price tables in SQLite (`gatewall.db`). |
| **Tools Registry** | `/tools` | Inspect all registered agent tools, domains, roles, and impact ratings. |

---

## 🕵️ Agent Action Tracing & Causal Replay

AvantGate automatically streams granular action traces from your agent execution engine directly to GateWall Cockpit.

### Traced Events

| Event Type | Triggered On | Captured Data |
|---|---|---|
| `STEP_START` | Agent step initialization | Step ID, run ID, start timestamp, context metadata |
| `TOOL_EXECUTION` | Isolated tool / action invocation | Tool ID, latency (`durationMs`), cost USD, tokens, PII filtration count, sanitized LLM summary |
| `STEP_APPROVAL_REQUEST` | Sensitive action paused for approval | Action type, sanitized arguments |
| `STEP_COMPLETED` / `STEP_FAILED` | Step completion or error | Execution output, error stack if failed |

### Connecting the Agent Runner

Use [`PlatformStorageAdapter`](../../src/agent/adapters/platform-adapter.ts) combined with [`HttpTelemetryExporter`](../../src/agent/telemetry/http-exporter.ts) to enable non-blocking, zero-overhead tracing:

```typescript
import { HttpTelemetryExporter, PlatformStorageAdapter } from "avantgate/agent";

// 1. Configure the non-blocking HTTP exporter
const exporter = new HttpTelemetryExporter({
  endpoint: "http://localhost:3000/api/v1/ingest/events",
  agentName: "ProspectingAgent",
  maxBatchSize: 10,
  flushIntervalMs: 3000,
});

// 2. Attach the hybrid storage adapter to your StepRunner
const storage = new PlatformStorageAdapter({
  exporter,
});

// Every step and tool execution is now live-streamed to Cockpit's /sessions timeline!
```

---

## 🔗 Related Observability Guides

* [GateWall & Temporal: Complementary Architecture](temporal-and-gatewall.md)
* [GateWall vs. Pydantic AI Gateway & Logfire](gatewall-vs-pydantic-gateway.md)
* [Telemetry Exporters & Browser React SDK](telemetry-and-browser-sdk.md)
* [Dynamic Pricing Adapters](../finops/pricing-adapters.md)
