# 🚀 AvantGate v1.4.0 — Release Notes

> **Release Date**: September 22, 2026  
> **NPM Package**: [`avantgate@1.4.0`](https://www.npmjs.com/package/avantgate)  
> **Release Type**: Minor / Feature Release — Deterministic Workflow Engine (`avantgate/workflow`), Reversible Saga Rollback, Durable Human-in-the-Loop Checkpoints & Native Agent Tool Conversion

---

## 📌 Executive Summary

The **v1.4.0** release introduces **`avantgate/workflow`**, a dedicated, zero-infrastructure in-process state machine engineered specifically for autonomous AI agents and high-consequence business orchestrations.

1. **Deterministic Sequential State Machine (Linear FSM)**: Enforces an immutable execution order via `steps: [...]`. Completely eliminates the risk of prompt injections or hallucinations causing agents to skip critical validation, spending-limit, or KYC steps (*anti-salami attack guarantee*).
2. **Reversible Saga Pattern Rollback**: When an intermediate step fails, all preceding successful steps are rolled back via their `compensate` handlers in **strictly reverse order** ($k-1 \to 0$), guaranteeing application-level consistency without distributed locks.
3. **Durable Human-in-the-Loop Checkpoints**: Steps can suspend execution non-blockingly (`ctx.waitForApproval()`) using AvantGate's [`StepStorageAdapter`](file:///c:/Users/Bui/Desktop/DevProjets/avantGate/src/agent/types.ts) ecosystem, saving execution snapshots and allowing idempotent resumption by `runId` without thread starvation.
4. **Native AI Agent Tool Conversion (`workflow.asTool()`)**: Seamlessly exposes complete multi-step workflows as standard agent tools (`IsolatedTool`), inheriting AvantGate v1.3.0 tool governance and automatically setting `requireApproval: true` for `DESTRUCTIVE` workflows (*Safe-by-Default*).
5. **Zero-Infrastructure Footprint**: Pure in-process TypeScript runtime (< 15 KB bundle). Zero heavy external dependencies (no Temporal, no Celery, no Redis clusters required).

---

## 🔍 Detailed Features & Code Examples

### 1. ⚡ Defining Workflows (`defineWorkflow`)

Workflows are declared with Zod input validation schemas, role-based access control, side-effect impact profiling, and granular steps:

```typescript
import { defineWorkflow } from "avantgate/workflow";
import { z } from "zod";

export const onboardUserWorkflow = defineWorkflow({
  name: "onboard_user",
  description: "Creates user profile, provisions workspace, and notifies admin",
  roles: ["ADMIN", "MANAGER"],
  impact: "MUTATIVE",

  inputSchema: z.object({
    email: z.string().email(),
    fullName: z.string(),
    plan: z.enum(["starter", "pro"]),
  }),

  steps: [
    {
      name: "create_user_record",
      description: "Creates user in core database",
      async execute(ctx) {
        const user = await db.users.create({
          email: ctx.input.email,
          fullName: ctx.input.fullName,
        });
        return { userId: user.id };
      },
      async compensate(ctx) {
        // Automatically invoked if any subsequent step fails
        const { userId } = ctx.getStepResult<{ userId: string }>("create_user_record");
        await db.users.delete({ id: userId });
      },
    },
    {
      name: "provision_workspace",
      description: "Allocates tenant storage and databases",
      async execute(ctx) {
        const { userId } = ctx.getStepResult<{ userId: string }>("create_user_record");
        const workspace = await cloudProvider.createWorkspace({
          ownerId: userId,
          tier: ctx.input.plan,
        });
        return { workspaceId: workspace.id, url: workspace.url };
      },
      async compensate(ctx) {
        const result = ctx.getStepResult<{ workspaceId: string }>("provision_workspace");
        await cloudProvider.destroyWorkspace(result.workspaceId);
      },
    },
    {
      name: "send_welcome_email",
      description: "Dispatches welcome email with credentials",
      async execute(ctx) {
        const { userId } = ctx.getStepResult<{ userId: string }>("create_user_record");
        const { url } = ctx.getStepResult<{ url: string }>("provision_workspace");
        await mailer.send(ctx.input.email, { userId, url });
        return { delivered: true };
      },
    },
  ],

  // Optional projection of the final output DTO
  outputDto: (result, ctx) => ({
    success: result.status === "COMPLETED",
    userId: result.stepResults.create_user_record.userId,
    workspaceUrl: result.stepResults.provision_workspace.url,
  }),
});
```

---

### 2. 🔄 Automatic Reverse Saga Rollback (`WorkflowSagaRollbackError`)

If step 3 fails, steps 2 and 1 are rolled back in reverse order ($2 \to 1$):

```typescript
import { WorkflowSagaRollbackError } from "avantgate/workflow";

try {
  const result = await onboardUserWorkflow.run({
    input: { email: "alex@enterprise.com", fullName: "Alex Rivera", plan: "pro" },
  });
} catch (error) {
  if (error instanceof WorkflowSagaRollbackError) {
    console.error(`💥 Failed at step [${error.failedStep}]: ${error.originalError.message}`);
    console.warn("Compensated steps in reverse order:", error.compensatedSteps);
    // error.failedCompensations contains any compensation handlers that threw
  }
}
```

---

### 3. ⏸️ Durable Human-in-the-Loop Checkpoints & Resumption

Sensitive workflows can pause execution for human verification without server locking:

```typescript
// 1. Initial execution suspends when approval is needed
const runResult = await highValuePaymentWorkflow.run({
  runId: "tx-54321",
  storageAdapter: prismaStorage,
  input: { beneficiaryIban: "FR76...", amountEuros: 75000 },
});

console.log(runResult.status); // "WAITING_APPROVAL"

// 2. Resumption after operator signs off (e.g. from an admin dashboard or webhook)
const finalResult = await highValuePaymentWorkflow.resume("tx-54321", {
  approved: true,
  feedback: "Signed off by Head of Finance",
  storageAdapter: prismaStorage,
});

console.log(finalResult.status); // "COMPLETED"
```

---

### 4. 🤖 1-Line AI Agent Tool Conversion (`asTool()`)

```typescript
import { ToolRegistry, MaxImpactToolStrategy } from "avantgate/agent";

// Convert workflow into an agent-ready tool
export const paymentTool = highValuePaymentWorkflow.asTool({
  storageAdapter: prismaStorage,
});

// Register and govern via AvantGate confinement strategies
const registry = new ToolRegistry();
registry.register(paymentTool);

// An agent bounded by MaxImpactToolStrategy("MUTATIVE") is
// mathematically barred from invoking this DESTRUCTIVE tool!
const safeStrategy = new MaxImpactToolStrategy("MUTATIVE");
const safeTools = safeStrategy.selectTools(registry.getAll(), { role: "FINANCE" });
```

---

## 🏛️ Architectural Rationale: Why Deterministic Linear FSM?

AvantGate deliberately chose a **deterministic sequential state machine** over dynamic graph frameworks:
- **Zero Salami Attacks**: LLMs cannot bypass security, spend-limit, or KYC verification steps.
- **Trivial Causal Rollbacks**: In a linear sequence, the causal rollback order ($k-1 \to 0$) is mathematically guaranteed, avoiding the NP-hard non-determinism of cyclic graphs.
- **KISS & Zero Bloat**: No redundant `dependsOn` declarations, no external DSLs, no Temporal/Redis server clusters.

> 📖 For full documentation, refer to [`docs/workflow.md`](file:///c:/Users/Bui/Desktop/DevProjets/avantGate/docs/workflow.md).

---

## 🧪 Verification & Test Coverage

- **100% Pass** across 15 test suites (Core, Agent, Finance, Governance, Impact, Workflow Saga & HITL).
- **TypeScript**: 0 compilation errors (`tsc --noEmit`).
- **Build**: Full ESM, CJS, and `.d.ts` bundles generated with tsup.
