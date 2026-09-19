# 🚀 AvantGate v1.2.0 — Release Notes

> **Release Date**: September 19, 2026  
> **NPM Package**: [`avantgate@1.2.0`](https://www.npmjs.com/package/avantgate)  
> **Release Type**: Minor Feature Release — Tool Access Governance, Business Domains, Anti-IDOR Guards & Universal Invalidation Tags

---

## 📌 Executive Summary

The **v1.2.0** release of AvantGate brings native **Access Governance, Business Domain partitioning, Anti-IDOR guardrails, and Universal Cache Invalidation Tags** directly to the `avantgate/agent` submodule.

1. **Declarative Tool Metadata (`createIsolatedTool`)**: Declare `domain`, `resource`, `roles`, `permissions`, and `requireApproval` natively at tool instantiation.
2. **Pre-execution Data Access Guards (`dataAccessGuard`)**: Block illegitimate tenant access and IDOR vulnerabilities before tool execution, raising `ToolAccessDeniedError`.
3. **Universal Cache Invalidation Tags (`invalidationTags`)**: Automatically compute `domain:resource` cache tags upon mutations, consumable out-of-band by Next.js (`revalidateTag`) or TanStack Query.
4. **Unified Strategy (`AccessControlToolStrategy`)**: Single-pass evaluation of allowed domains, user roles, and granular permissions without class multiplication.
5. **Enriched Registry (`ToolRegistry`)**: Added `registerMany`, `getByDomain`, domain-filtered dictionary export `toRecord({ domain })`, and headless metadata descriptors `getDescriptors()`.

---

## 🔍 Detailed Features & Code Examples

### 1. 🛡️ Declarative Metadata & Security Guards

```typescript
import { createIsolatedTool, ToolAccessDeniedError } from "avantgate/agent";
import { z } from "zod";

export const deleteProspectTool = createIsolatedTool({
  name: "delete_prospect",
  domain: "crm",                  // 🏢 Business domain
  resource: "prospects",          // 📦 Entity resource
  roles: ["ADMIN"],               // 👥 Allowed roles
  permissions: ["crm:delete"],     // 🔐 Granular permissions
  requireApproval: true,          // ✋ Human-in-the-Loop flag

  // 🛡️ Row-Level Security guard (anti-IDOR)
  async dataAccessGuard(args, context) {
    return args.tenantId === (context?.tenantId as string);
  },

  // 🏷️ Universal cache tags (domain:resource format)
  invalidationTags: (args) => ["crm:prospects", `crm:prospects:${args.id}`],

  parameters: z.object({ id: z.string(), tenantId: z.string() }),
  async execute(args) {
    return await db.prospects.delete({ where: { id: args.id } });
  },
});
```

### 2. 🎯 Unified Access Control Strategy (`AccessControlToolStrategy`)

Instead of combining multiple strategies, `AccessControlToolStrategy` checks allowed domains, roles, and permissions in one step:

```typescript
import { ToolRegistry, AccessControlToolStrategy } from "avantgate/agent";

const registry = new ToolRegistry();
registry.registerMany([createLeadTool, deleteProspectTool, sendInvoiceTool]);

const strategy = new AccessControlToolStrategy({
  allowedDomains: ["crm"],
});

const toolsForSales = strategy.selectTools(registry.getAll(), {
  role: "SALES",
  permissions: ["crm:write"],
});

// Directly pass to Vercel AI SDK
const aiTools = ToolRegistry.toRecord(toolsForSales);
```

### 3. 📋 Headless Descriptors & Domain Filtering

```typescript
// Filter tools by business domain
const crmTools = registry.getByDomain("crm");
const crmToolsRecord = registry.toRecord({ domain: "crm" });

// Export technical descriptors for UI clients (no UI coupling)
const descriptors = registry.getDescriptors({ domain: "crm", role: "ADMIN" });
```

---

## 🔄 Backward Compatibility

- **100% Backward Compatible**: Existing tools without `domain` or `roles` continue to operate normally.
- `RoleBasedToolStrategy` and `PhaseBasedToolStrategy` remain fully supported.
