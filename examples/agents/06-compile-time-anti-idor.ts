import { createTenantTool, dto } from "avantgate/agent";
import { z } from "zod";

interface InvoiceRecord {
  id: string;
  tenantId: string;
  totalAmount: number;
  status: string;
}

export const getInvoiceTool = createTenantTool({
  name: "get_invoice",
  roles: ["FINANCE", "ADMIN"],
  parameters: z.object({ invoiceId: z.string() }),

  // 🛡️ Required at compile time: tsc fails if assertTenant is omitted
  assertTenant: (invoice: InvoiceRecord) => invoice.tenantId,

  execute: async (args, context) => {
    // Simulated DB query scoped by tenant
    const invoice: InvoiceRecord = {
      id: args.invoiceId,
      tenantId: context?.tenantId || "tenant_default",
      totalAmount: 4500,
      status: "PAID",
    };

    return invoice;
  },

  // LLM receives only safe summary fields
  llmDto: dto.pick(["id", "totalAmount", "status"]),
});
