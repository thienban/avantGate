"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  SessionRun,
  ApprovalItem,
  FinOpsSummary,
  ToolHealthMetric,
} from "@/lib/types/telemetry";

export const QUERY_KEYS = {
  SESSIONS: ["sessions"] as const,
  SESSION_DETAIL: (id: string) => ["sessions", id] as const,
  METRICS: ["metrics"] as const,
  APPROVALS: ["approvals"] as const,
};

export const useSessionsQuery = () => {
  return useQuery<{ sessions: SessionRun[] }>({
    queryKey: QUERY_KEYS.SESSIONS,
    queryFn: async () => {
      const res = await fetch("/api/v1/sessions");
      if (!res.ok) throw new Error("Erreur lors de la récupération des sessions");
      return res.json();
    },
  });
};

export const useSessionDetailQuery = (sessionId: string | null) => {
  return useQuery<{ session: SessionRun }>({
    queryKey: sessionId ? QUERY_KEYS.SESSION_DETAIL(sessionId) : ["sessions", "none"],
    queryFn: async () => {
      if (!sessionId) throw new Error("No session ID specified");
      const res = await fetch(`/api/v1/sessions/${sessionId}`);
      if (!res.ok) throw new Error("Erreur lors de la récupération de la session");
      return res.json();
    },
    enabled: Boolean(sessionId),
  });
};

export const useMetricsQuery = () => {
  return useQuery<{ finops: FinOpsSummary; toolHealth: ToolHealthMetric[] }>({
    queryKey: QUERY_KEYS.METRICS,
    queryFn: async () => {
      const res = await fetch("/api/v1/metrics");
      if (!res.ok) throw new Error("Erreur lors de la récupération des métriques");
      return res.json();
    },
  });
};

export const useApprovalsQuery = () => {
  return useQuery<{ approvals: ApprovalItem[] }>({
    queryKey: QUERY_KEYS.APPROVALS,
    queryFn: async () => {
      const res = await fetch("/api/v1/approvals");
      if (!res.ok) throw new Error("Erreur lors de la récupération des approbations");
      return res.json();
    },
  });
};


export const useDecideApprovalMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      id: string;
      decision: "APPROVED" | "REJECTED";
      reason?: string;
      decidedBy?: string;
    }) => {
      const res = await fetch("/api/v1/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Échec de la validation de l'approbation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.APPROVALS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SESSIONS });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.METRICS });
    },
  });
};

export const useRealtimeStream = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    let eventSource: EventSource | null = null;

    try {
      eventSource = new EventSource("/api/v1/realtime");

      eventSource.addEventListener("session_update", () => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SESSIONS });
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.METRICS });
      });

      eventSource.addEventListener("approval_required", () => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.APPROVALS });
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SESSIONS });
      });

      eventSource.addEventListener("approval_decided", () => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.APPROVALS });
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SESSIONS });
      });
    } catch (err) {
      console.warn("SSE connection skipped or unsupported in this environment:", err);
    }

    return () => {
      if (eventSource) {
        eventSource.close();
      }
    };
  }, [queryClient]);
};
