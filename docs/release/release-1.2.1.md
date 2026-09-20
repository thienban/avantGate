# 🚀 AvantGate v1.2.1 — Release Notes

> **Release Date**: September 20, 2026  
> **NPM Package**: [`avantgate@1.2.1`](https://www.npmjs.com/package/avantgate)  
> **Release Type**: Patch / Feature Release — Compile-Time Schema Drift Guard (`dto.exhaustivePick`), Strict Typed Projections & Dual-Channel Documentation

---

## 📌 Executive Summary

The **v1.2.1** release of AvantGate introduces strict compile-time protection against **Silent Schema Drift** (*The Orphan Schema Trap*) in `avantgate/agent`, accompanied by strong generic typing for DTO helpers and comprehensive architectural documentation.

1. **Compile-Time Exhaustive Projection (`dto.exhaustivePick`)**: Enforces explicit conscious arbitration (`keep` vs `drop`) on 100% of the properties of a source entity.
2. **Fail Loudly at Build Time (`_unassignedSourceFields`)**: If a backend developer adds new fields to a raw data model 6 months later, TypeScript refuses to compile until every new field is explicitly categorized, preventing LLMs from hallucinating over incomplete context.
3. **Overlapping Collision Guard (`_overlappingFields`)**: Prevents human error by guaranteeing that a property cannot be declared in both `keep` and `drop`.
4. **Strongly-Typed Autocomplete (`dto.pick<TSource>()`)**: Enhances developer ergonomics with IDE auto-completion for allowed keys while maintaining 100% backward compatibility.
5. **Zero Runtime Overhead & Defensive Null-Safety**: All exhaustiveness checks are strictly static (`tsc`), with lightweight execution and safe handling of `null` or non-object inputs.
6. **Dual-Channel Architecture Documentation**: Detailed guidance in `docs/agent.md` explaining when to use static `dto.exhaustivePick` versus Custom Functional DTOs (`(data, args, context) => ...`).

---

## 🔍 Detailed Features & Code Examples

### 1. 🛡️ Preventing Silent Schema Drift with `dto.exhaustivePick`

In agentic architectures, the raw server output (`execute`) is projected into a minimal summary for the LLM (`llmDto`). When schemas evolve asynchronously, passive picking silently ignores newly added business columns, leading the model to reason with absolute confidence over incomplete data.

`dto.exhaustivePick<TSource>()` eliminates this vulnerability:

```typescript
import { createIsolatedTool, dto } from "avantgate/agent";
import { z } from "zod";

interface OrderEntity {
  id: string;
  status: string;
  totalAmount: number;
  internalStripeToken: string;
  fraudScore: number;
}

export const getOrderTool = createIsolatedTool({
  name: "get_order",
  description: "Fetch order details for customer support",
  parameters: z.object({ orderId: z.string() }),
  async execute(args): Promise<OrderEntity> {
    return await db.orders.findById(args.orderId);
  },

  // 🔒 Every field of OrderEntity must be explicitly classified
  llmDto: dto.exhaustivePick<OrderEntity>()({
    keep: ["id", "status", "totalAmount"],
    drop: ["internalStripeToken", "fraudScore"],
  }),
});
```

#### What happens if `cancellationReason: string` is added to `OrderEntity`?

TypeScript immediately halts compilation with an explicit type error:

```
Property '_unassignedSourceFields' is missing in type '{ keep: [...]; drop: [...]; }'
Type '"cancellationReason"' is not assignable to type 'never'.
```

The developer is forced to explicitly decide whether `cancellationReason` should be communicated to the LLM (`keep`) or discarded (`drop`).

---

### 2. ⚡ Autocompletion for `dto.pick<TSource>()`

Existing `dto.pick` now accepts an optional generic `TSource` for full IDE autocompletion of allowed fields:

```typescript
// Autocompletes keys from OrderEntity
export const orderSummaryTool = createIsolatedTool({
  name: "get_order_summary",
  description: "Get order status",
  parameters: z.object({ orderId: z.string() }),
  execute: fetchOrder,
  llmDto: dto.pick<OrderEntity>(["id", "status"]),
});
```

---

### 3. 🧭 Decision Matrix: `dto.exhaustivePick` vs Custom Functional DTO

| Use Case | Recommended Approach | Why? |
|---|---|---|
| **Raw Entity Read** (`getOrder`, `getUserProfile`) | `dto.exhaustivePick` | 1:1 pass-through with compile-time drift protection if columns change. |
| **Simple Mutations** (`updateStatus`, `sendEmail`) | `dto.boolean()` or `dto.booleanWithId()` | Model only needs a clean `{ success: true }` acknowledgment. |
| **Volume & Listing** (`listDrafts`) | `dto.count()` | Prevents bloating context with arrays of items. |
| **Aggregation, Calculations & Context** (`checkAvailability`, `searchFlights`) | **Custom Functional DTO** | Deriving computed metrics, formatting, and correlating with `args` / `context.state`. |

---

## 🔄 Backward Compatibility

- **100% Backward Compatible**: Existing tools utilizing `dto.pick(["key"])`, `dto.boolean()`, or custom mapper functions continue to operate without modification.
- Zero extra dependencies added.
