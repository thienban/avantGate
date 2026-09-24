"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useApprovalsQuery, useDecideApprovalMutation } from "@/hooks/useTelemetry";
import {
  UserCheck,
  Check,
  X,
  Clock,
  ShieldAlert,
} from "lucide-react";

export const ApprovalsView: React.FC = () => {
  const { data, isLoading } = useApprovalsQuery();
  const decideMutation = useDecideApprovalMutation();
  const [reasonInputs, setReasonInputs] = useState<Record<string, string>>({});

  if (isLoading || !data) {
    return (
      <div className="p-8 text-center text-zinc-400 text-sm">
        Chargement des demandes d&apos;approbations...
      </div>
    );
  }

  const approvals = data.approvals;
  const pendingApprovals = approvals.filter((a) => a.status === "PENDING");
  const decidedApprovals = approvals.filter((a) => a.status !== "PENDING");

  const handleDecision = (id: string, decision: "APPROVED" | "REJECTED") => {
    const reason = reasonInputs[id] || (decision === "APPROVED" ? "Validé par l'opérateur" : "Rejeté");
    decideMutation.mutate({
      id,
      decision,
      reason,
      decidedBy: "Opérateur Sécurité",
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="p-5 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-950/40 via-orange-950/20 to-zinc-950/40 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-amber-500/20 border border-amber-500/30 text-amber-400">
            <UserCheck className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              Mission Control : Human-in-the-Loop
              <Badge variant="warning">{pendingApprovals.length} en attente</Badge>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Validez ou rejetez en temps réel les actions critiques des agents suspendues avec <code>step.waitForApproval()</code>.
            </p>
          </div>
        </div>
      </div>

      {/* Pending Approvals Section */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <span>Actions Suspendues Nécessitant Validation</span>
          <span className="text-xs text-zinc-400 font-normal">({pendingApprovals.length})</span>
        </h3>

        {pendingApprovals.length === 0 ? (
          <Card className="p-8 text-center text-zinc-400 text-xs border-dashed border-zinc-800">
            Aucune action critique en attente. Tous les agents fonctionnent dans leur périmètre nominal.
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {pendingApprovals.map((item) => (
              <Card
                key={item.id}
                className="border-amber-500/30 bg-zinc-950/90 p-5 space-y-4 shadow-lg shadow-amber-500/5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-zinc-800">
                  <div className="flex items-center gap-2.5">
                    <span className="p-1.5 rounded-md bg-amber-500/20 text-amber-400">
                      <ShieldAlert className="h-4 w-4" />
                    </span>
                    <div>
                      <h4 className="text-sm font-bold text-white font-mono">{item.actionType}</h4>
                      <p className="text-xs text-zinc-400">
                        Agent: <strong className="text-zinc-200">{item.agentName}</strong> • Étape : {item.stepName}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs font-mono text-zinc-400">
                    <Clock className="h-3.5 w-3.5" />
                    <span>Reçu à {item.createdAt.slice(11, 19)}</span>
                  </div>
                </div>

                {/* Payload Summary preview */}
                <div>
                  <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5">
                    Détails du Payload d&apos;Action Sensible :
                  </span>
                  <pre className="p-3.5 rounded-lg bg-zinc-900/80 border border-zinc-800 text-xs font-mono text-amber-200/90 overflow-x-auto">
                    {JSON.stringify(item.payloadSummary, null, 2)}
                  </pre>
                </div>

                {/* Decision form */}
                <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                  <Input
                    placeholder="Motif ou instruction (ex: Validé pour le compte Acme Corp)..."
                    value={reasonInputs[item.id] || ""}
                    onChange={(e) =>
                      setReasonInputs((prev) => ({ ...prev, [item.id]: e.target.value }))
                    }
                    className="flex-1 text-xs"
                  />
                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <Button
                      variant="success"
                      size="sm"
                      onClick={() => handleDecision(item.id, "APPROVED")}
                      disabled={decideMutation.isPending}
                      className="w-full sm:w-auto"
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Approuver
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleDecision(item.id, "REJECTED")}
                      disabled={decideMutation.isPending}
                      className="w-full sm:w-auto"
                    >
                      <X className="h-4 w-4 mr-1" />
                      Rejeter
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* History of Past Decisions */}
      <div className="space-y-3 pt-4">
        <h3 className="text-sm font-semibold text-white">Historique Récent des Décisions</h3>
        <Card className="border-zinc-800/80 bg-zinc-950/70 p-4">
          <div className="space-y-2.5">
            {decidedApprovals.map((item) => (
              <div
                key={item.id}
                className="p-3 rounded-lg border border-zinc-800/70 bg-zinc-900/40 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div className="flex items-center gap-3">
                  <Badge variant={item.status === "APPROVED" ? "success" : "destructive"}>
                    {item.status === "APPROVED" ? "Approuvé" : "Rejeté"}
                  </Badge>
                  <div>
                    <span className="font-semibold text-zinc-200">{item.actionType}</span>
                    <span className="text-zinc-400 ml-2">({item.agentName})</span>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-zinc-400 text-[11px]">
                  <span>Par : <strong className="text-zinc-200">{item.decidedBy || "Admin"}</strong></span>
                  <span>Motif : &quot;{item.reason || "N/A"}&quot;</span>
                  <span className="font-mono">{item.decidedAt?.slice(11, 19)}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};
