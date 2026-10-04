import React from "react";
import { useTelemetry } from "avantgate/client";

export const FeedbackWidget: React.FC<{ runId: string }> = ({ runId }) => {
  const { emitUserFeedback, emitSecurityAlert } = useTelemetry({
    endpoint: "http://localhost:3000/api/v1/ingest/events",
    agentName: "CustomerSupportAgent",
    runId,
  });

  return (
    <div className="flex gap-2 p-2 border rounded">
      <button
        onClick={() => emitUserFeedback({ score: 1, comment: "Accurate response" })}
        className="px-3 py-1 bg-green-100 text-green-800 rounded"
      >
        👍 Helpful
      </button>
      <button
        onClick={() => emitSecurityAlert({ alertType: "PII_LEAK_SUSPECTED", message: "Review needed" })}
        className="px-3 py-1 bg-red-100 text-red-800 rounded"
      >
        🚩 Flag Security
      </button>
    </div>
  );
};
