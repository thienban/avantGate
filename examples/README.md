# 📖 AvantGate Integration Examples & Recipes

Modular, executable examples demonstrating AvantGate integration patterns across its functional layers.

---

## 📂 Examples Directory Structure

| Category | Example File | Description |
|---|---|---|
| ⚡ **Core** | [`core/01-basic-completion.ts`](core/01-basic-completion.ts) | Basic completion and in-process USD token cost calculation. |
| ⚡ **Core** | [`core/02-zod-structured-output.ts`](core/02-zod-structured-output.ts) | Strict schema validation with automatic heuristic JSON repair. |
| ⚡ **Core** | [`core/03-multi-model-failover.ts`](core/03-multi-model-failover.ts) | Client-side routing to fallback models on HTTP 429/500 errors. |
| 🛡️ **Security** | [`security/04-prompt-injection-defense.ts`](security/04-prompt-injection-defense.ts) | In-process detection and blocking of DAN jailbreaks and injections. |
| 🛡️ **Security** | [`security/05-in-flight-pii-redaction.ts`](security/05-in-flight-pii-redaction.ts) | Zero-egress local redaction of French NIR SSN, IBANs, and emails. |
| 🤖 **Agents** | [`agents/06-compile-time-anti-idor.ts`](agents/06-compile-time-anti-idor.ts) | Multi-tenant tenant boundary enforcement verified at compile-time. |
| 💰 **FinOps** | [`finops/07-preflight-budgeting.ts`](finops/07-preflight-budgeting.ts) | Enforcing hard token and USD bounds *before* paying for inference. |
| 💰 **FinOps** | [`finops/08-sqlite-pricing-adapter.ts`](finops/08-sqlite-pricing-adapter.ts) | Dynamic model pricing persistence using embedded SQLite. |
| 🔄 **Workflows** | [`workflows/09-saga-workflow.ts`](workflows/09-saga-workflow.ts) | Linear state machine with automatic reverse compensation on failure. |
| 📊 **Observability** | [`observability/10-gatewall-telemetry.ts`](observability/10-gatewall-telemetry.ts) | Streaming async audit traces and PII logs to GateWall Cockpit. |
| 💻 **Client** | [`client/11-react-telemetry-hook.tsx`](client/11-react-telemetry-hook.tsx) | Front-end React hook (`useTelemetry`) capturing security feedback. |
| 💶 **Finance** | [`finance/12-financial-normalizer.ts`](finance/12-financial-normalizer.ts) | Accounting parentheses, currency magnitudes, and VAT calculation. |
| 🎨 **UI Canvas** | [`ui/13-headless-canvas.ts`](ui/13-headless-canvas.ts) | Headless UI canvas state, canonical envelopes, and React view dispatch. |

---

## 🔗 Architectural Guides

For detailed specifications, security models, and architectural deep-dives, see our [Documentation Pillars](../docs/):
- [Prompt Guardrails & AI-WAF](../docs/security/prompt-guardrails.md)
- [Zero-Egress PII Redaction](../docs/security/pii-redaction.md)
- [Compile-Time Anti-IDOR Defense](../docs/security/anti-idor.md)
- [Pre-Flight Budget Guards](../docs/finops/budget-guards.md)
- [Durable Workflows Engine](../docs/workflows/durable-workflows.md)
- [GateWall Cockpit Console](../docs/observability/gatewall-cockpit.md)
- [Headless UI Canvas & React Presentation Plane](../docs/ui/headless-canvas.md)
