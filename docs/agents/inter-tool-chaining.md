# 🔗 Inter-Tool Chaining, Anti-Loop Shield & Blackboard State

AvantGate allows isolated tools to call other isolated tools hierarchically (`context.callTool`) while preventing infinite loops, tracking execution depth, and exchanging private state without polluting the LLM's context window.

---

## ⚡ Key Protections

1. **Loop Shield (Anti-Cycle Guard)**: Intercepts recursive cycles (e.g. `Tool A ➔ Tool B ➔ Tool A`) immediately with `CircularToolCallError`.
2. **Depth Limiting**: Rejects deep runaway executions exceeding `maxDepth` with `ToolCallDepthExceededError`.
3. **Blackboard Shared State (`context.state`)**: Enables tools to pass heavy binary data, session variables, or intermediate tokens out-of-band.

---

## 💻 1. Inter-Tool Sub-Call (`context.callTool`)

```typescript
import { createIsolatedTool } from "avantgate/agent";
import { z } from "zod";

export const parentTool = createIsolatedTool({
  name: "process_order",
  parameters: z.object({ orderId: z.string(), amount: z.number() }),
  async execute(args, context) {
    // Invoke another registered tool safely:
    const tax = await context?.callTool<{ taxAmount: number }>("calc_tax", {
      amount: args.amount,
    });
    return { orderId: args.orderId, total: args.amount + (tax?.taxAmount ?? 0) };
  },
});
```

---

## 💾 2. Blackboard Shared State (`context.state`)

```typescript
export const stepOneTool = createIsolatedTool({
  name: "fetch_raw_telemetry",
  parameters: z.object({ deviceId: z.string() }),
  async execute(args, context) {
    const rawData = await sensorApi.getDump(args.deviceId); // 10 MB payload!
    // Store in blackboard without sending 10 MB to LLM context:
    await context?.state?.set(`sensor_${args.deviceId}`, rawData, 300);
    return { deviceId: args.deviceId, cached: true };
  },
  llmDto: (res) => ({ status: "cached_successfully" }),
});
```

---

## 🔗 Related Guides

* [Isolated Tools & Dual-Channel Governance](isolated-tools.md)
* [Durable Workflows & Saga Rollback](../workflows/durable-workflows.md)
