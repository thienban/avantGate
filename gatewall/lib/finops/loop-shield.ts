import { ToolExecutionEvent } from "@/lib/types/telemetry";

export interface LoopDetectionResult {
  isLoopDetected: boolean;
  toolName: string;
  consecutiveCount: number;
  reason?: string;
}

export const generateToolCallFingerprint = (event: ToolExecutionEvent): string => {
  const summaryKey = event.llmSummary ? JSON.stringify(event.llmSummary) : "";
  const alias = event.aliasUsed || event.toolName;
  return `${event.toolName}:${alias}:${summaryKey.slice(0, 100)}`;
};

export const detectInfiniteLoop = (
  toolEvents: ToolExecutionEvent[],
  threshold = 3
): LoopDetectionResult => {
  if (toolEvents.length < threshold) {
    return { isLoopDetected: false, toolName: "", consecutiveCount: 0 };
  }

  const lastEvents = toolEvents.slice(-threshold);
  const targetTool = lastEvents[lastEvents.length - 1].toolName;
  const lastFingerprint = generateToolCallFingerprint(lastEvents[lastEvents.length - 1]);

  const allIdentical = lastEvents.every(
    (ev) => generateToolCallFingerprint(ev) === lastFingerprint
  );

  if (allIdentical) {
    return {
      isLoopDetected: true,
      toolName: targetTool,
      consecutiveCount: threshold,
      reason: `Agent exécuté ${threshold} fois consécutives l'outil '${targetTool}' avec des arguments identiques sans progression causale.`,
    };
  }

  return { isLoopDetected: false, toolName: "", consecutiveCount: 0 };
};
