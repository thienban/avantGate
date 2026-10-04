import { defineCanvas } from "avantgate/ui";
import { createViewRegistry, type CanvasViewComponent, isValidSafeUrl } from "avantgate/ui/react";
import React from "react";

// 1. Declare the type-safe dictionary mapping view kinds to their data payloads
export interface CRMCanvasMap {
  prospect_search: {
    totalFound: number;
    prospects: Array<{ id: string; name: string; stage: string }>;
  };
  prospect_dossier: {
    prospectId: string;
    score: number;
  };
}

// 2. Instantiate the strongly typed envelope factory and deterministic parallel reducer
export const { createEnvelope, canvasReducer } = defineCanvas<CRMCanvasMap>();

// 3. Define React view components using your existing design system (shadcn/ui, Tailwind)
const ProspectSearchResultsView: CanvasViewComponent<CRMCanvasMap["prospect_search"]> = ({
  data,
  context,
  activeIntent,
}) => {
  return React.createElement("div", { className: "p-4 space-y-2" }, [
    React.createElement("h3", { key: "title", className: "font-bold" }, `Found ${data.totalFound} Prospects`),
    React.createElement(
      "ul",
      { key: "list", className: "divide-y" },
      data.prospects.map((p) =>
        React.createElement(
          "li",
          {
            key: p.id,
            className: `p-2 cursor-pointer ${activeIntent?.targetId === p.id ? "bg-blue-100" : ""}`,
            onClick: () => context.onSelectEntity?.(p.id, "prospect"),
          },
          `${p.name} (${p.stage})`
        )
      )
    ),
  ]);
};

const ProspectDossierView: CanvasViewComponent<CRMCanvasMap["prospect_dossier"]> = ({ data }) => {
  return React.createElement(
    "div",
    { className: "p-4 border rounded" },
    `Dossier #${data.prospectId} — Score: ${data.score}/100`
  );
};

// 4. Create polymorphic O(1) View Registry and CanvasRenderer
export const { CanvasRenderer } = createViewRegistry<CRMCanvasMap>({
  prospect_search: ProspectSearchResultsView,
  prospect_dossier: ProspectDossierView,
});

// 5. Example URL sanitization before rendering links
export const isLinkClickable = (rawUrl: string): boolean => {
  return isValidSafeUrl(rawUrl);
};
