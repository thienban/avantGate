"use client";

import React from "react";
import { Badge } from "@/components/ui/Badge";
import { SessionRun } from "@/lib/types/telemetry";
import { formatDuration } from "@/lib/utils";
import { Clock, ThumbsUp, ThumbsDown, Layers } from "lucide-react";

interface SessionStreamListProps {
  sessions: SessionRun[];
  selectedRunId: string;
  onSelectRun: (runId: string) => void;
}

export const SessionStreamList: React.FC<SessionStreamListProps> = ({
  sessions,
  selectedRunId,
  onSelectRun,
}) => {
  const getStatusBadge = (session: SessionRun) => {
    if (session.status === "WAITING_APPROVAL") {
      return (
        <Badge variant="warning" className="animate-pulse text-[10px]">
          Approbation Requise
        </Badge>
      );
    }
    if (session.clientSecurityAlertsCount > 0) {
      return (
        <Badge variant="destructive" className="text-[10px]">
          Alerte Client
        </Badge>
      );
    }
    if (session.loopAlertTriggered) {
      return (
        <Badge variant="destructive" className="text-[10px]">
          Loop Shield
        </Badge>
      );
    }
    if (session.status === "COMPLETED") {
      return <Badge variant="success" className="text-[10px]">Conforme</Badge>;
    }
    return <Badge variant="info" className="text-[10px]">En Cours</Badge>;
  };

  return (
    <div className="flex flex-col space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider">
          Runs Agentiques & Démo ProspectAI ({sessions.length})
        </h2>
        <span className="text-[10px] text-slate-500 dark:text-zinc-500 font-mono">Stream Live</span>
      </div>

      <div className="space-y-2.5">
        {sessions.map((session) => {
          const isSelected = selectedRunId === session.runId;

          return (
            <div
              key={session.runId}
              onClick={() => onSelectRun(session.runId)}
              className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                isSelected
                  ? "border-emerald-500/60 bg-emerald-50/70 shadow-xs ring-1 ring-emerald-500/30 dark:border-emerald-500/50 dark:bg-emerald-950/20 dark:shadow-md dark:shadow-emerald-500/10"
                  : "border-slate-200/90 bg-white hover:bg-slate-50 hover:border-slate-300 shadow-xs dark:border-zinc-800/80 dark:bg-zinc-900/40 dark:hover:bg-zinc-900/70 dark:hover:border-zinc-700/80 dark:shadow-none"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="font-mono text-xs font-bold text-slate-900 dark:text-white truncate">
                  {session.runId}
                </span>
                {getStatusBadge(session)}
              </div>

              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-zinc-400 mb-2">
                <span className="text-slate-800 dark:text-zinc-300 font-medium truncate">{session.agentName}</span>
                {session.userFeedback && (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                    {session.userFeedback.rating === "POSITIVE" ? (
                      <ThumbsUp className="h-3 w-3" />
                    ) : (
                      <ThumbsDown className="h-3 w-3 text-rose-600 dark:text-rose-400" />
                    )}
                    {session.userFeedback.tag || "Feedback"}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-500 pt-2 border-t border-slate-100 dark:border-zinc-800/60 font-mono">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDuration(session.durationMs)}
                </span>
                <span className="flex items-center gap-1">
                  <Layers className="h-3 w-3" />
                  {session.eventsCount} événements
                </span>
                {session.piiFilteredCount > 0 && (
                  <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                    {session.piiFilteredCount} PII
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
