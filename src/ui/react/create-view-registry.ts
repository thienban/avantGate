import React from "react";
import type { UIIntent } from "../envelope";
import type { CanvasState } from "../reducer";

export interface CanvasViewContext {
  onSendMessage?: (prompt: string) => void;
  onSelectEntity?: (id: string, type?: string) => void;
  isAgentBusy?: boolean;
}

export type CanvasViewComponent<TData> = React.FC<{
  data: TData;
  context: CanvasViewContext;
  activeIntent?: UIIntent;
}>;

export interface CanvasRendererProps<TContentMap extends Record<string, unknown>> {
  state: CanvasState<TContentMap> | null | undefined;
  context?: CanvasViewContext;
}

export const createViewRegistry = <TContentMap extends Record<string, unknown>>(
  registry: { [K in keyof TContentMap]: CanvasViewComponent<TContentMap[K]> }
) => {
  const CanvasRenderer: React.FC<CanvasRendererProps<TContentMap>> = ({
    state,
    context = {},
  }) => {
    if (!state?.content) {
      return null;
    }

    const kind = state.content.kind as keyof TContentMap;
    const Component = registry[kind];

    if (!Component) {
      return null;
    }

    return React.createElement(Component as React.ComponentType<any>, {
      data: state.content,
      context,
      activeIntent: state.activeIntent,
    });
  };

  return {
    registry,
    CanvasRenderer,
  };
};
