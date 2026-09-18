# 🚀 AvantGate v1.1.2 — Release Notes

> **Release Date**: September 18, 2026  
> **NPM Package**: [`avantgate@1.1.2`](https://www.npmjs.com/package/avantgate)  
> **Release Type**: Major Feature, DTO Pattern Standardization & Documentation Refactoring

---

## 📌 Executive Summary

The **v1.1.2** release of AvantGate formalizes and standardizes the **DTO Pattern** for TypeScript agents within the `avantgate/agent` submodule, enforces strict runtime data contracts via Zod, and drastically streamlines the main documentation with a dedicated code recipes guide.

1. **DTO Pattern Standardization (`avantgate/agent`)**: Strict dual-channel separation between rich domain data streamed out-of-band to user interfaces (`clientDto`) and minimal cognitive projections dispatched to the language model (`llmDto`).
2. **Declarative Helper Library (`dto.*`)**: Ready-to-use constructors (`dto.boolean()`, `dto.booleanWithId()`, `dto.count()`, `dto.pick()`) eliminating repetitive boilerplate on mutation and read tools.
3. **Runtime Zod Contract Validation (`llmDtoSchema`)**: Mathematical and leak-proof enforcement against unexpected or hallucinated fields reaching the LLM, raising a dedicated `DtoValidationError`.
4. **Removal of Legacy Properties**: Complete retirement of `toLLMSummary` and `toClientData` in favor of the unified modern DTO API.
5. **Documentation Restructuring**: Introduction of `docs/examples.md` compiling 11 key control plane recipes and condensing `README.md` from 536 to 199 lines for maximum clarity and developer onboarding.

---

## 🔍 Detailed Features & Improvements

### 1. 🧩 Ready-to-Use Declarative DTO Helpers (`dto`)

In agentic architectures, state mutations (creating tasks, sending emails, updating CRM records) do not need to inject the entire server object into the LLM's context window.

The `avantgate/agent` submodule introduces the `dto` namespace:

```typescript
import { createIsolatedTool, dto } from "avantgate/agent";
import { z } from "zod";

// 1. Simple mutations: generates { success: boolean }
export const createTaskTool = createIsolatedTool({
  name: "create_task",
  description: "Create a task in CRM",
  parameters: z.object({ title: z.string() }),
  async execute(args) {
    return await db.tasks.create({ data: { title: args.title } });
  },
  llmDto: dto.boolean(),
});

// 2. Chaining with an opaque technical identifier: { success: boolean, taskId: string }
export const createTaskWithIdTool = createIsolatedTool({
  name: "create_task_with_id",
  description: "Create task and return opaque ID",
  parameters: z.object({ title: z.string() }),
  async execute(args) {
    return await db.tasks.create({ data: { title: args.title } });
  },
  llmDto: dto.booleanWithId("taskId"),
});

// 3. Numeric count without leaking internal array elements: { success: true, count: number }
export const countProspectsTool = createIsolatedTool({
  name: "count_prospects",
  description: "Count total prospects matching criteria",
  parameters: z.object({ query: z.string() }),
  async execute(args) {
    return { items: await db.prospects.findMany() };
  },
  llmDto: dto.count("items"),
});

// 4. Strict whitelist filtering (Pick whitelist)
export const getProspectSummaryTool = createIsolatedTool({
  name: "get_prospect_summary",
  description: "Get prospect summary",
  parameters: z.object({ id: z.string() }),
  async execute(args) {
    return await db.prospects.find(args.id);
  },
  llmDto: dto.pick(["id", "stage", "annualRevenue"]),
});
```

---

### 2. 🛡️ Zod Contract Validation for DTOs (`llmDtoSchema`)

To secure mission-critical applications (Fintech, Legaltech, Healthcare), `createIsolatedTool` now supports an optional Zod schema that validates the projected output before it reaches the model:

- If the projected DTO fails schema validation, a clear **`DtoValidationError`** is thrown immediately.
- Prevents any metadata leakage or unintended fields, even when using complex custom DTO mappers.

```typescript
import { createIsolatedTool, DtoValidationError } from "avantgate/agent";
import { z } from "zod";

export const executePaymentTool = createIsolatedTool({
  name: "execute_payment",
  description: "Execute corporate wire transfer",
  parameters: z.object({ amount: z.number(), beneficiaryId: z.string() }),
  async execute(args) {
    return await bankService.transfer(args);
  },
  llmDtoSchema: z.object({
    status: z.enum(["SETTLED", "PENDING"]),
    transactionId: z.string(),
  }),
  llmDto: (res) => ({
    status: res.settled ? "SETTLED" : "PENDING",
    transactionId: res.publicReference,
  }),
});
```

---

### 3. 🎯 Custom Functional DTOs & Execution Context Injection

For rich domain use cases (calendar slot search, custom aggregations), the `llmDto` mapper receives invocation arguments (`args`) as well as the execution context (`ToolExecutionContext`), allowing the projection to adapt dynamically to the running workflow:

```typescript
export const checkAvailabilityTool = createIsolatedTool({
  name: "check_availability",
  description: "Search for available slots",
  parameters: z.object({ limit: z.number() }),
  async execute(args) {
    return await fetchFreeSlots(args.limit);
  },
  llmDto: (slots, args, context) => ({
    workflowId: context?.workflowId,
    requestedLimit: args.limit,
    hasAvailableSlots: slots.length > 0,
    nextSlot: slots[0]?.start ?? null,
    totalSlotsFound: slots.length,
    slots: slots.map((s) => s.start), // ISO timestamps only, zero internal metadata
  }),
});
```

---

### 4. 🧹 API Cleanup & Legacy Property Removal

In accordance with clean code standards and strict architectural rigor:
- Legacy properties `toLLMSummary` and `toClientData` have been completely removed in favor of `llmDto` and `clientDto`.
- Corresponding TypeScript types have been unified under `LLMDtoMapper` and `ClientDtoCallback`.

---

### 5. 📚 Documentation Refactoring

- **New [`docs/examples.md`](../examples.md)**: Exhaustive compilation of 11 core recipes (completions, Zod auto-repair, multi-model failover, PII masking, pre-flight budgets, prompt engine, etc.).
- **Streamlined [`README.md`](../../README.md)**: Reduced from 536 to 199 lines, focused on core value proposition with direct links to specialized guides.
- **GateWall Platform Alignment**: Clear positioning of the enterprise offering (Enterprise AI-WAF, Corporate DLP, Reversible Ephemeral Tokenization Vault).

---

## 🧪 Verification & Non-Regression

All automated test suites pass with **100%** success rate:
- `tests/avantgate.test.ts`
- `tests/preflight-budget.test.ts`
- `tests/financial-normalizer.test.ts`
- `tests/prompt-builder.test.ts`
- `tests/pii-extended.test.ts`
- `tests/agent/step-runner.test.ts`
- `tests/agent/isolated-tool.test.ts`
- `tests/agent/dto-pattern.test.ts` *(new dedicated test suite)*
- `tests/agent/tool-patterns.test.ts`
- `tests/agent/storage-adapters.test.ts`
- `tests/agent/tool-aliasing.test.ts`
- `tests/agent/tool-chaining.test.ts`
- `tests/agent/tool-storage.test.ts`
- `tests/agent/telemetry-exporter.test.ts`
- `tests/agent/platform-adapter.test.ts`

`tsup` compilation:
- `dist/index.js` (CJS) & `dist/index.mjs` (ESM)
- `dist/finance/index.js` & `dist/finance/index.mjs`
- `dist/agent/index.js` & `dist/agent/index.mjs`
- `.d.ts` and `.d.mts` generated with zero TypeScript diagnostics (`tsc --noEmit`).

---

## 📦 Upgrade Guide

To upgrade to **v1.1.2**:

```bash
npm install avantgate@1.1.2
```

If you were using the `avantgate/agent` submodule, simply update your tool configuration properties:
- `toLLMSummary` ➔ `llmDto`
- `toClientData` ➔ `clientDto`
