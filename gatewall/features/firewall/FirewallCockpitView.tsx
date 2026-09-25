"use client";

import React, { useState } from "react";
import {
  useSessionsQuery,
  useSessionDetailQuery,
  useApprovalsQuery,
  useDecideApprovalMutation,
  useRealtimeStream,
} from "@/hooks/useTelemetry";
import { FirewallHeader } from "./FirewallHeader";
import { SessionStreamList } from "./SessionStreamList";
import { ApprovalActionCard } from "./ApprovalActionCard";
import { DualPassInspector } from "./DualPassInspector";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { AlertOctagon, Terminal } from "lucide-react";

export const FirewallCockpitView: React.FC = () => {
  useRealtimeStream(); // Active listening to real-time events via SSE
  const { data: sessionsData, isLoading: isSessionsLoading } = useSessionsQuery();
  const { data: approvalsData } = useApprovalsQuery();
  const decideMutation = useDecideApprovalMutation();

  const [selectedRunId, setSelectedRunId] = useState<string>("run-prospect-101");
  const { data: detailData } = useSessionDetailQuery(selectedRunId);

  const sessions = sessionsData?.sessions || [];
  const approvals = approvalsData?.approvals || [];

  const currentSession =
    detailData?.session ||
    sessions.find((s) => s.runId === selectedRunId) ||
    sessions[0];

  const currentApproval = approvals.find(
    (a) => a.runId === currentSession?.runId && a.status === "PENDING"
  );

  const totalProtectedPii = sessions.reduce((acc, s) => acc + (s.piiFilteredCount || 0), 0);
  const totalClientAlerts = sessions.reduce(
    (acc, s) => acc + (s.clientSecurityAlertsCount || 0),
    0
  );

  const handleApprove = (id: string) => {
    decideMutation.mutate({ id, decision: "APPROVED", decidedBy: "Commercial Manager" });
  };

  const handleReject = (id: string) => {
    decideMutation.mutate({ id, decision: "REJECTED", decidedBy: "Commercial Manager" });
  };

  if (isSessionsLoading || !sessions.length) {
    return (
      <div className="p-12 text-center text-slate-500 dark:text-zinc-400 text-sm">
        Connexion à la passerelle temps réel avantGate...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Firewall & Compliance Status Banner */}
      <FirewallHeader
        totalProtectedPii={totalProtectedPii}
        totalClientAlerts={totalClientAlerts}
        selectedRunId={currentSession?.runId || "run-prospect-101"}
      />

      {/* Main Cockpit Grid: 4 cols for Sessions & 8 cols for Dual-Pass Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Live Run Stream (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          <SessionStreamList
            sessions={sessions}
            selectedRunId={currentSession?.runId || ""}
            onSelectRun={setSelectedRunId}
          />
        </div>

        {/* Right Column: Dual-Pass Inspector & Actions (8 cols) */}
        <div className="lg:col-span-8 space-y-5">
          {currentSession ? (
            <>
              {/* Approval Card if this session is waiting approval */}
              {currentApproval && (
                <ApprovalActionCard
                  approval={currentApproval}
                  onApprove={handleApprove}
                  onReject={handleReject}
                  isPending={decideMutation.isPending}
                />
              )}

              {/* Loop Shield Alert Banner */}
              {currentSession.loopAlertTriggered && (
                <div className="p-3.5 rounded-xl border border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-950/30 text-xs text-rose-800 dark:text-rose-300 flex items-center gap-2.5">
                  <AlertOctagon className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  <span>
                    <strong>Disjoncteur Loop Shield Déclenché :</strong> Boucle infinie d&apos;outils
                    interceptée avec succès avant surconsommation financière.
                  </span>
                </div>
              )}

              {/* Dual-Pass Firewall Inspector (Pass 1 Client + Pass 2 Enclave) */}
              <DualPassInspector session={currentSession} />

              {/* Step-by-Step Causal Timeline Replay */}
              <Card className="border-slate-200/90 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/70 p-4 rounded-xl space-y-3 shadow-xs dark:shadow-none">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-zinc-800 pb-2">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                      Timeline Causale Ordonnée ({currentSession.events.length} événements)
                    </h3>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    Run : {currentSession.runId}
                  </Badge>
                </div>

                <div className="space-y-2 text-xs">
                  {currentSession.events.map((event, index) => (
                    <div
                      key={index}
                      className="p-2.5 rounded-lg border border-slate-200/80 dark:border-zinc-800/80 bg-slate-50 dark:bg-zinc-900/40 flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2 w-2 rounded-full ${
                            event.type === "CLIENT_SECURITY_ALERT"
                              ? "bg-rose-500 ring-2 ring-rose-500/30"
                              : event.type === "STEP_APPROVAL_REQUEST"
                              ? "bg-amber-400"
                              : event.type === "CLIENT_DATA_RENDERED"
                              ? "bg-cyan-500"
                              : event.type === "USER_FEEDBACK"
                              ? "bg-emerald-500"
                              : "bg-indigo-500"
                          }`}
                        />
                        <span className="font-semibold text-slate-800 dark:text-zinc-200">{event.type}</span>
                        {"stepName" in event && (
                          <span className="text-slate-500 dark:text-zinc-400 font-mono text-[11px]">
                            ({(event as { stepName: string }).stepName})
                          </span>
                        )}
                        {"toolName" in event && (
                          <span className="text-slate-500 dark:text-zinc-400 font-mono text-[11px]">
                            ({(event as { toolName: string }).toolName})
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 dark:text-zinc-500 font-mono">
                        {event.timestamp.slice(11, 19)}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          ) : (
            <div className="p-8 text-center text-slate-500 dark:text-zinc-400">
              Sélectionnez une session pour inspecter son flux.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
