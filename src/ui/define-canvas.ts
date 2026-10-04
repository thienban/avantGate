import { createToolEnvelope, type ToolExecutionEnvelope } from "./envelope";
import { createCanvasReducer } from "./reducer";

export const defineCanvas = <TContentMap extends Record<string, unknown>>() => {
  return {
    createEnvelope: <K extends Extract<keyof TContentMap, string>>(
      options: Omit<ToolExecutionEnvelope<TContentMap[K], K>, "version">
    ): ToolExecutionEnvelope<TContentMap[K], K> => {
      return createToolEnvelope<K, TContentMap[K]>(options);
    },

    canvasReducer: createCanvasReducer<TContentMap>(),
  };
};
