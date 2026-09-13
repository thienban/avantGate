import { z } from "zod";
import {
  createIsolatedTool,
  ToolRegistry,
  createToolInvoker,
  CircularToolCallError,
  ToolCallDepthExceededError,
  auditToolResult,
} from "../../src/agent";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runToolChainingTests() {
  console.log("🔗 Testing avantgate/agent Tool Chaining & Anti-Cycle Guard...\n");

  const registry = new ToolRegistry();

  // Tool: Tax Calculator (Sub-tool)
  const taxTool = createIsolatedTool({
    id: "calc_tax",
    name: "calc_tax",
    description: "Calculate tax rate",
    parameters: z.object({ amount: z.number() }),
    async execute(args) {
      return { tax: args.amount * 0.2 };
    },
  });

  // Tool: Invoice Generator (Parent tool calling calc_tax)
  const invoiceTool = createIsolatedTool({
    id: "generate_invoice",
    name: "generate_invoice",
    description: "Generate invoice",
    parameters: z.object({ subtotal: z.number() }),
    async execute(args, context) {
      const taxResult = await context?.callTool<{ tax: number }>("calc_tax", {
        amount: args.subtotal,
      });
      return {
        subtotal: args.subtotal,
        tax: taxResult?.tax ?? 0,
        total: args.subtotal + (taxResult?.tax ?? 0),
      };
    },
  });

  registry.register({ id: "calc_tax", name: "calc_tax", description: "tax", tool: taxTool });
  registry.register({ id: "generate_invoice", name: "generate_invoice", description: "invoice", tool: invoiceTool });

  const invoker = createToolInvoker(registry);

  // Test 1: Successful Tool Chaining
  const invoice = await invoker.invokeTool<{ total: number }>("generate_invoice", {
    subtotal: 100,
  });
  assert(invoice.total === 120, "Parent tool invoked sub-tool calc_tax successfully");

  // Test 2: Concurrency & Promise.all (immutable callChain)
  const parallelTool = createIsolatedTool({
    id: "parallel_caller",
    name: "parallel_caller",
    description: "Calls subtools in parallel",
    parameters: z.object({ amounts: z.array(z.number()) }),
    async execute(args, context) {
      const results = await Promise.all(
        args.amounts.map((amount) =>
          context?.callTool<{ tax: number }>("calc_tax", { amount })
        )
      );
      return results;
    },
  });

  registry.register({ id: "parallel_caller", name: "parallel_caller", description: "p", tool: parallelTool });
  const parallelRes = await invoker.invokeTool<any[]>("parallel_caller", {
    amounts: [50, 100, 200],
  });
  assert(parallelRes.length === 3, "Parallel tool chaining executed without chain corruption");
  assert(parallelRes[1].tax === 20, "Parallel sub-calls returned correct independent values");

  // Test 3: Circular Tool Call Detection (Tool A -> Tool B -> Tool A)
  const toolA = createIsolatedTool({
    id: "cycle_a",
    name: "cycle_a",
    description: "A",
    parameters: z.object({}),
    async execute(_, ctx) {
      return await ctx?.callTool("cycle_b", {});
    },
  });

  const toolB = createIsolatedTool({
    id: "cycle_b",
    name: "cycle_b",
    description: "B",
    parameters: z.object({}),
    async execute(_, ctx) {
      return await ctx?.callTool("cycle_a", {});
    },
  });

  registry.register({ id: "cycle_a", name: "cycle_a", description: "a", tool: toolA });
  registry.register({ id: "cycle_b", name: "cycle_b", description: "b", tool: toolB });

  let circularCaught = false;
  try {
    await invoker.invokeTool("cycle_a", {});
  } catch (err) {
    if (err instanceof CircularToolCallError) {
      circularCaught = true;
      assert(
        err.cycle.includes("cycle_a") && err.cycle.includes("cycle_b"),
        "CircularToolCallError identifies the loop cycle"
      );
    }
  }
  assert(circularCaught, "Circular tool call loop was intercepted immediately");

  // Test 4: Max Call Depth Limit
  const shallowInvoker = createToolInvoker(registry, undefined, { maxDepth: 1 });
  let depthExceededCaught = false;
  try {
    await shallowInvoker.invokeTool("generate_invoice", { subtotal: 100 });
  } catch (err) {
    if (err instanceof ToolCallDepthExceededError) {
      depthExceededCaught = true;
    }
  }
  assert(depthExceededCaught, "ToolCallDepthExceededError caught when depth exceeds maxDepth");

  // Test 5: Circular Object Reference Guard in PII Sanitizer
  const circularObj: any = { name: "Root Organization", email: "corp@corp.fr" };
  circularObj.self = circularObj; // Circular memory reference

  const sanitized = auditToolResult(circularObj, { toolName: "circular_obj_test" });
  assert(
    (sanitized.sanitizedData as any).self === "[CIRCULAR_REFERENCE]",
    "Circular object reference is safely elided as [CIRCULAR_REFERENCE]"
  );
  assert(
    (sanitized.sanitizedData as any).email === "[REDACTED_EMAIL]",
    "PII masking still executes successfully on non-circular properties of the object"
  );

  console.log("\n🎉 All Tool Chaining & Anti-Cycle tests passed successfully!");
}

runToolChainingTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
