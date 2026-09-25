# 📡 Telemetry Exporters & Browser React SDK (`avantgate/client`)

AvantGate provides zero-dependency telemetry bridges to stream execution logs to your observability platform without blocking the main event loop, as well as a lightweight (< 1.7 KB) client SDK for web applications.

---

## 💻 1. Server-Side Telemetry Bridge (`HttpTelemetryExporter`)

```typescript
import { HttpTelemetryExporter } from "avantgate/agent";

const exporter = new HttpTelemetryExporter({
  endpoint: "http://localhost:3000/api/v1/ingest/events",
  maxBatchSize: 20,
  flushIntervalMs: 3000,
});
```

---

## 🌐 2. Client-Side Browser Hook (`avantgate/client`)

Capture front-end security alerts, user feedback, and UI rendering telemetry directly from React components:

```tsx
import { useAvantGateTelemetry } from "avantgate/client";

export const AIAssistantChat = () => {
  const { emitEvent, emitFeedback } = useAvantGateTelemetry({
    endpoint: "/api/v1/ingest/events",
    agentName: "SupportAgent",
  });

  const handleUserThumbsUp = (messageId: string) => {
    emitFeedback(messageId, { score: 1, comment: "Accurate answer" });
  };

  return <div>AI Chat Component</div>;
};
```

---

## 🔗 Related Guides

* [GateWall Cockpit Console](gatewall-cockpit.md)
* [Isolated Tools](../agents/isolated-tools.md)
