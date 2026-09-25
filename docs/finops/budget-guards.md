# 💰 Pre-Flight Budget Guarding & FinOps Defense (`avantgate`)

AvantGate enforces financial and resource limits **before** making external model API calls. If a prompt or estimated cost exceeds your allocated budget, it halts immediately with a `BudgetExceededError`, avoiding wasted spend and protecting against Denial-of-Wallet attacks.

---

## ⚡ Why Pre-Flight Budgeting Matters

Traditional observability tools (Langfuse, Portkey, Helicone) only tell you how much money you spent **after** the request completes. If an attacker injects a 50,000-token prompt or a user triggers an infinite generation loop, you only find out when you receive the bill.

AvantGate calculates estimated tokens and cent-level cost in-process **before egress**, blocking malicious requests at 0 cost.

---

## 💻 Quickstart Recipe

```typescript
import { createAvantGate, BudgetExceededError } from "avantgate";

const control = createAvantGate({
  primary: {
    provider: "deepseek",
    model: "deepseek-chat",
    apiKey: process.env.DEEPSEEK_API_KEY!,
  },
  maxTokenBudget: 500,  // Maximum allowed tokens (prompt + estimated completion)
  maxCostUSD: 0.005,    // Maximum allowed cost: $0.005 (half a cent)
});

try {
  const response = await control.execute({
    userQuery: "Please provide an exhaustive 50-page legal audit of this merger contract...",
  });
} catch (error) {
  if (error instanceof BudgetExceededError) {
    console.warn("🛑 Blocked by AvantGate Pre-Flight Budget Guard:", error.message);
    // User response: "Query exceeds maximum token allowance. Please refine your request."
  }
}
```

---

## 🔗 Related FinOps Guides

* [Dynamic Pricing & SQLite Adapters](pricing-adapters.md) — Store and update model pricing rules dynamically.
* [GateWall Cockpit](../observability/gatewall-cockpit.md) — Visual dashboard tracking real-time USD burn.
