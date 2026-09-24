"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useSessionsQuery, useSessionDetailQuery } from "@/hooks/useTelemetry";
import { formatCurrency, formatDuration, formatTokens } from "@/lib/utils";
import {
  Clock,
  Cpu,
  ShieldCheck,
  AlertOctagon,
  Terminal,
  Layers,
} from "lucide-react";
import { SessionRun } from "@/lib/types/telemetry";

export const SessionsView: React.FC = () => {
  const { data, isLoading } = useSessionsQuery();
  const [selectedId, setSelectedId] = useState<string>("run-prospect-101");
  const { data: detailData } = useSessionDetailQuery(selectedId);

  if (isLoading || !data) {
    return <div className="p-8 text-center text-zinc-400 text-sm">Chargement des sessions...</div>;
  }

  const sessions = data.sessions;
  const currentSession: SessionRun | undefined = detailData?.session || sessions.find((s) => s.runId === selectedId) || sessions[0];

  const getStatusBadge = (status: SessionRun["status"]) => {
    switch (status) {
      case "COMPLETED":
        return <Badge variant="success">Terminé</Badge>;
      case "WAITING_APPROVAL":
        return <Badge variant="warning">Approbation Requise</Badge>;
      case "FAILED":
        return <Badge variant="destructive">Échec / Disjoncté</Badge>;
      default:
        return <Badge variant="info">En Cours</Badge>;
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-140px)]">
      {/* Sessions Master List (4 cols) */}
      <div className="lg:col-span-4 flex flex-col space-y-3 overflow-y-auto pr-1">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-sm font-semibold text-white">Sessions Récentes ({sessions.length})</h2>
          <span className="text-[11px] text-zinc-400">Tri par date</span>
        </div>

        <div className="space-y-2.5">
          {sessions.map((session) => {
            const isSelected = currentSession?.runId === session.runId;
            return (
              <div
                key={session.runId}
                onClick={() => setSelectedId(session.runId)}
                className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                  isSelected
                    ? "border-indigo-500/50 bg-indigo-950/20 shadow-md shadow-indigo-500/10"
                    : "border-zinc-800/80 bg-zinc-900/40 hover:bg-zinc-900/70 hover:border-zinc-700/80"
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-xs font-semibold text-white truncate">
                    {session.runId}
                  </span>
                  {getStatusBadge(session.status)}
                </div>

                <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
                  <span className="text-zinc-300 font-medium">{session.agentName}</span>
                  <span className="font-mono text-indigo-400 font-semibold">
                    {formatCurrency(session.totalCostUsd)}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-[11px] text-zinc-400 pt-2 border-t border-zinc-800/60">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDuration(session.durationMs)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Cpu className="h-3 w-3" />
                    {formatTokens(session.totalTokens)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Layers className="h-3 w-3" />
                    {session.eventsCount} étapes
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Session Replay Detail (8 cols) */}
      <div className="lg:col-span-8 flex flex-col overflow-y-auto space-y-4">
        {currentSession ? (
          <>
            {/* Session Header Card */}
            <Card className="border-zinc-800/80 bg-zinc-950/80 p-5">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-white font-mono">{currentSession.runId}</h2>
                    {getStatusBadge(currentSession.status)}
                  </div>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Agent : <strong className="text-zinc-200">{currentSession.agentName}</strong> • Modèle :{" "}
                    <strong className="text-zinc-200">{currentSession.model}</strong>
                  </p>
                </div>

                <div className="flex items-center gap-4 text-xs font-mono">
                  <div className="px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60">
                    <span className="text-zinc-400 block text-[10px]">COÛT TOTAL</span>
                    <span className="text-emerald-400 font-bold">
                      {formatCurrency(currentSession.totalCostUsd)}
                    </span>
                  </div>
                  <div className="px-3 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60">
                    <span className="text-zinc-400 block text-[10px]">TOKENS</span>
                    <span className="text-indigo-400 font-bold">
                      {formatTokens(currentSession.totalTokens)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Infinite Loop Alert if triggered */}
              {currentSession.loopAlertTriggered && (
                <div className="p-3 mb-2 rounded-lg border border-rose-500/30 bg-rose-950/30 text-xs text-rose-300 flex items-center gap-2">
                  <AlertOctagon className="h-4 w-4 text-rose-400 shrink-0" />
                  <span>
                    <strong>Disjoncteur Loop Shield Déclenché :</strong> Boucle infinie d&apos;outils interceptée avec succès avant surconsommation financière.
                  </span>
                </div>
              )}
            </Card>

            {/* Step-by-Step Replay Timeline */}
            <Card className="border-zinc-800/80 bg-zinc-950/80 p-5 flex-1">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-indigo-400" />
                  <h3 className="text-sm font-semibold text-white">Timeline Replay Causal</h3>
                </div>
                <Badge variant="outline" className="text-[11px]">
                  {currentSession.events.length} événements ordonnés
                </Badge>
              </div>

              <div className="relative border-l-2 border-zinc-800 ml-4 space-y-6 pb-2">
                {currentSession.events.map((event, index) => {
                  return (
                    <div key={index} className="relative pl-6">
                      {/* Timeline dot */}
                      <div
                        className={`absolute -left-[9px] top-1.5 h-4 w-4 rounded-full border-2 border-zinc-950 ${
                          event.type === "STEP_APPROVAL_REQUEST"
                            ? "bg-amber-400 ring-4 ring-amber-400/20"
                            : event.type === "TOOL_EXECUTION"
                            ? "bg-indigo-500"
                            : "bg-emerald-500"
                        }`}
                      />

                      <div className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/50 space-y-2">
                        {/* Event Title Row */}
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                            {event.type === "STEP_START" && "▶ Début d'Étape"}
                            {event.type === "TOOL_EXECUTION" && "⚙ Appel d'Outil Sécurisé"}
                            {event.type === "STEP_COMPLETED" && "✔ Étape Validée"}
                            {event.type === "STEP_APPROVAL_REQUEST" && "✋ Approbation Humaine Requise"}
                            <span className="font-mono text-zinc-400 text-[11px]">
                              {event.type === "TOOL_EXECUTION"
                                ? event.toolName
                                : "stepName" in event
                                ? (event as { stepName: string }).stepName
                                : ""}
                            </span>
                          </span>
                          <span className="text-[10px] text-zinc-400 font-mono">
                            {event.timestamp.slice(11, 19)}
                          </span>
                        </div>

                        {/* Tool Execution Details */}
                        {event.type === "TOOL_EXECUTION" && (
                          <div className="space-y-2 text-xs">
                            <div className="flex flex-wrap gap-2 text-[11px]">
                              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
                                Latence : {event.durationMs}ms
                              </span>
                              <span className="px-2 py-0.5 rounded bg-indigo-950/60 text-indigo-300 border border-indigo-500/30">
                                Coût : {formatCurrency(event.costUsd || 0)}
                              </span>
                              {event.piiFilteredCount > 0 && (
                                <span className="px-2 py-0.5 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                                  <ShieldCheck className="h-3 w-3" />
                                  {event.piiFilteredCount} PII masquées
                                </span>
                              )}
                            </div>

                            {/* Safe LLM Summary preview */}
                            {event.llmSummary && (
                              <div className="p-2.5 rounded-lg bg-zinc-950/80 border border-zinc-800 text-zinc-300 font-mono text-[11px] overflow-x-auto">
                                <span className="text-zinc-400 block text-[10px] uppercase font-bold mb-1">
                                  Résumé Sanitisé transmis au LLM :
                                </span>
                                {JSON.stringify(event.llmSummary, null, 2)}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Approval Request Details */}
                        {event.type === "STEP_APPROVAL_REQUEST" && (
                          <div className="p-3 rounded-lg bg-amber-950/20 border border-amber-500/30 text-xs text-amber-200 space-y-1.5">
                            <p className="font-semibold">
                              Action Sensible : {event.actionType}
                            </p>
                            <pre className="text-[11px] font-mono text-zinc-300 bg-zinc-950/60 p-2 rounded border border-amber-500/20 overflow-x-auto">
                              {JSON.stringify(event.payloadSummary, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </>
        ) : (
          <div className="p-8 text-center text-zinc-400">Sélectionnez une session pour inspecter son replay.</div>
        )}
      </div>
    </div>
  );
};
