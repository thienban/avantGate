# 🎨 Headless UI Canvas & Presentation Plane (`avantgate/ui`)

> **The Zero-Dependency, In-Process Presentation Plane for AI Agents and Copilots.**  
> Unifies AI agent outputs with interactive UI workspaces (lateral Canvas, CRM tables, timelines) using canonical envelopes, deterministic parallel reduction, and polymorphic React view dispatch.

---

## ⚡ Why a Headless Presentation Plane?

In production AI applications (CRM copilots, financial analytics, sales assistants), LLMs execute actions and return structured data. However, connecting these actions to an interactive user interface exposes major architectural pain points:

1. **Race Conditions in Parallel Tool Calling**: When the model triggers multiple tools in parallel (`parallel_tool_calling`), asynchronous responses arrive out of order. Traditional frontends overwrite each other's state, causing visual flickering and data loss.
2. **Reverse-Engineering Fragile Message Parts**: Frontend code often ends up with 300+ lines of ad-hoc `switch (toolName)` parsing `messages[i].parts` or raw JSON streams without compile-time schemas.
3. **Rigid Vendor Lock-in**: Off-the-shelf copilot UI libraries bundle 40+ transitive dependencies (> 250 KB) and enforce opinionated UI widgets incompatible with your existing design system (shadcn/ui, Tailwind).
4. **Injection & XSS**: Tools generating dynamic external links risk XSS exploitation via `javascript:` or protocol-relative (`//evil.com`) redirect vectors.

**`avantgate/ui` solves this by remaining strictly Headless and Zero-Dependency**: it manages envelopes, algebraic state convergence, and dispatching, while your application retains 100% sovereignty over visual components.

```mermaid
flowchart LR
    Tool[🤖 createIsolatedTool] -->|clientDto| Envelope[✉️ createToolEnvelope]
    Envelope --> Reducer[⚡ createCanvasReducer<br/>O(N) Set Deduplication]
    Reducer --> State[📦 CanvasState]
    State --> Registry[⚛️ createViewRegistry<br/>O(1) Dynamic Dispatch]
    Registry --> AppViews[💻 Your Views<br/>shadcn/ui & Tailwind]
```

---

## 💻 Complete Integration Recipe

### Step 1: Declare your Application Canvas Schema (`src/lib/canvas.ts`)

```typescript
import { defineCanvas } from "avantgate/ui";

// 1. Declare the type-safe dictionary mapping every view kind to its payload
export interface AppCanvasMap {
  prospect_search: {
    totalFound: number;
    prospects: Array<{ id: string; name: string; stage: string; city: string | null }>;
  };
  prospect_dossier: {
    prospectId: string;
    score: number;
    tasksCount: number;
  };
}

// 2. Export the strongly typed envelope factory and reducer
export const { createEnvelope, canvasReducer } = defineCanvas<AppCanvasMap>();
```

---

### Step 2: Wrap Agent Tool Outputs in Canonical Envelopes (`src/lib/agent/tools.ts`)

```typescript
import { createIsolatedTool } from "avantgate/agent";
import { z } from "zod";
import { createEnvelope } from "@/lib/canvas";

export const searchProspectsTool = createIsolatedTool({
  name: "search_prospects",
  domain: "crm",
  parameters: z.object({ query: z.string() }),
  execute: async ({ query }) => {
    return await db.prospects.search(query);
  },

  // 🛡️ Presentation Plane: Canonical Envelope with merge strategy and intent
  clientDto: (result) => ({
    envelope: createEnvelope({
      toolId: "search_prospects",
      kind: "prospect_search",
      mergeStrategy: "APPEND_UNIQUE",
      dedupeKey: "id",
      uiIntent: {
        action: "HIGHLIGHT",
        targetId: result.topMatchId,
        targetType: "prospect",
      },
      data: {
        totalFound: result.total,
        prospects: result.items,
      },
    }),
  }),

  // 🔒 Control Plane: Model receives only a minimal summary (Zero PII Egress)
  llmDto: (result) => ({ count: result.items.length }),
});
```

---

### Step 3: Register React Views & Render Dynamic Canvas (`src/components/canvas/registry.tsx`)

```tsx
import React from "react";
import { createViewRegistry, type CanvasViewComponent, isValidSafeUrl } from "avantgate/ui/react";
import type { AppCanvasMap } from "@/lib/canvas";

// 1. Define your domain-specific components using your own design system (shadcn/ui, Tailwind)
const ProspectSearchResultsView: CanvasViewComponent<AppCanvasMap["prospect_search"]> = ({
  data,
  context,
  activeIntent,
}) => {
  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold">Found {data.totalFound} Prospects</h3>
      <div className="divide-y rounded-md border">
        {data.prospects.map((prospect) => {
          const isHighlighted = activeIntent?.targetId === prospect.id;
          return (
            <div
              key={prospect.id}
              onClick={() => context.onSelectEntity?.(prospect.id, "prospect")}
              className={`p-3 cursor-pointer transition ${
                isHighlighted ? "bg-blue-50 ring-2 ring-blue-500" : "hover:bg-slate-50"
              }`}
            >
              <div className="font-medium">{prospect.name}</div>
              <div className="text-sm text-slate-500">{prospect.stage} • {prospect.city}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ProspectDossierView: CanvasViewComponent<AppCanvasMap["prospect_dossier"]> = ({ data }) => {
  return (
    <div className="p-4 rounded-lg bg-white shadow-sm border">
      <h4 className="font-bold">Dossier #{data.prospectId}</h4>
      <p className="text-slate-600">Score: {data.score}/100 • {data.tasksCount} active tasks</p>
    </div>
  );
};

// 2. Create the polymorphic O(1) registry and Renderer
export const { CanvasRenderer } = createViewRegistry<AppCanvasMap>({
  prospect_search: ProspectSearchResultsView,
  prospect_dossier: ProspectDossierView,
});
```

---

### Step 4: Host Canvas in your Layout (`src/components/CopilotWorkspace.tsx`)

```tsx
import React, { useReducer } from "react";
import { canvasReducer, type AppCanvasMap } from "@/lib/canvas";
import { CanvasRenderer } from "./registry";
import type { CanvasState, ToolExecutionEnvelope } from "avantgate/ui";

export const CopilotWorkspace: React.FC = () => {
  const [canvasState, dispatchEnvelope] = useReducer(
    canvasReducer,
    { content: null } as CanvasState<AppCanvasMap>
  );

  // When your agent emits an envelope from clientDto:
  const handleToolEnvelopeReceived = (envelope: ToolExecutionEnvelope) => {
    dispatchEnvelope(envelope as any);
  };

  return (
    <div className="flex h-screen w-full">
      {/* Main Chat Timeline */}
      <main className="flex-1 p-6">
        <h1 className="text-2xl font-bold">AI Assistant</h1>
      </main>

      {/* Dynamic Lateral Canvas */}
      <aside className="w-[450px] border-l p-4 bg-slate-50 overflow-y-auto">
        <CanvasRenderer
          state={canvasState}
          context={{
            onSendMessage: (prompt) => console.log("User action:", prompt),
            onSelectEntity: (id, type) => console.log("Selected:", id, type),
          }}
        />
      </aside>
    </div>
  );
};
```

---

## 🛡️ Built-in Security: Anti-XSS Sanitizer Guard

Tools emitting dynamic URLs should always be validated before rendering in clickable `<a>` tags:

```typescript
import { isValidSafeUrl } from "avantgate/ui/react";

isValidSafeUrl("https://company.com");            // ✅ true
isValidSafeUrl("/dashboard/prospects/42");        // ✅ true
isValidSafeUrl("#details");                         // ✅ true
isValidSafeUrl("javascript:alert(document.cookie)");// ❌ false (Dangerous scheme)
isValidSafeUrl("//phishing.attacker.com/login");    // ❌ false (Protocol-relative bypass)
```

---

## 📦 Subpath Architecture & Bundle Impact

| Export Path | Environment | Size (minified) | Dependencies |
|---|---|---|---|
| `avantgate/ui` | Universal (Node, Browser, Cloudflare, Edge) | **< 2.5 KB** | **0 dependencies** |
| `avantgate/ui/react` | React 18+ (Next.js, Vite, Remix) | **< 1.5 KB** | Optional `react` peer |

---

## 🔗 Related Guides

- [Agent Runtime & Isolated Tools](../agents/isolated-tools.md)
- [Client Task Replay & Telemetry SDK](../observability/telemetry-and-browser-sdk.md)
- [Release Notes v2.1.0](../release/release-2.1.0.md)
