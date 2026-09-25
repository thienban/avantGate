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
| **Dual-Pass Inspector** | `/firewall` | Compare masked PII summaries (`llmSummary`) vs local escrow (`rawPayload`). |
| **HITL Approval Queue** | `/firewall` | Review and click **Approve** or **Reject** on suspended tools. |
| **FinOps Administration** | `/pricing` | Add, edit, and seed LLM model price tables in SQLite (`gatewall.db`). |
| **Tools Registry** | `/tools` | Inspect all registered agent tools, domains, roles, and impact ratings. |

---

## 🔗 Connecting SDK to GateWall Cockpit

Configure `HttpTelemetryExporter` in your backend:

```typescript
import { HttpTelemetryExporter } from "avantgate/agent";

const exporter = new HttpTelemetryExporter({
  endpoint: "http://localhost:3000/api/v1/ingest/events",
  apiKey: "optional-gatewall-secret",
  maxBatchSize: 10,
  flushIntervalMs: 5000,
});
```

---

## 🔗 Related Observability Guides

* [Telemetry Exporters & Browser React SDK](telemetry-and-browser-sdk.md)
* [Dynamic Pricing Adapters](../finops/pricing-adapters.md)
