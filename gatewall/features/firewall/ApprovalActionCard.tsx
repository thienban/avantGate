"use client";

import React from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ApprovalItem } from "@/lib/types/telemetry";
import { AlertTriangle, CheckCircle, XCircle } from "lucide-react";

interface ApprovalActionCardProps {
  approval: ApprovalItem;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  isPending: boolean;
}

export const ApprovalActionCard: React.FC<ApprovalActionCardProps> = ({
  approval,
  onApprove,
  onReject,
  isPending,
}) => {
  return (
    <Card className="border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-zinc-900/90 to-zinc-950/90 p-4 rounded-xl space-y-3 shadow-lg shadow-amber-950/10">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/20 pb-2.5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-400 animate-pulse" />
          <span className="text-xs font-bold text-amber-200 uppercase tracking-wider">
            Action Critique Suspendue (Human-in-the-Loop)
          </span>
        </div>
        <Badge variant="warning" className="text-[10px]">
          Attente Décision Humaine
        </Badge>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div>
          <span className="text-zinc-400">Action :</span>{" "}
          <strong className="text-white font-mono">{approval.actionType}</strong>
        </div>
        <div className="text-[11px] text-zinc-400">
          Agent : <strong className="text-zinc-200">{approval.agentName}</strong>
        </div>
      </div>

      <div className="p-3 rounded-lg bg-zinc-950/80 border border-amber-500/20 text-xs font-mono text-zinc-300 overflow-x-auto max-h-36">
        <div className="text-[10px] uppercase font-bold text-amber-400/80 mb-1">
          Détails de l&apos;Action de Prospection (Payload) :
        </div>
        <pre className="text-[11px] leading-relaxed">
          {JSON.stringify(approval.payloadSummary, null, 2)}
        </pre>
      </div>

      <div className="flex items-center justify-end gap-2.5 pt-1">
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => onReject(approval.id)}
          className="border-rose-500/40 bg-rose-950/20 text-rose-300 hover:bg-rose-900/40 text-xs"
        >
          <XCircle className="h-3.5 w-3.5 mr-1" />
          Rejeter
        </Button>
        <Button
          size="sm"
          disabled={isPending}
          onClick={() => onApprove(approval.id)}
          className="bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md shadow-emerald-600/20"
        >
          <CheckCircle className="h-3.5 w-3.5 mr-1" />
          Approuver l&apos;Envoi
        </Button>
      </div>
    </Card>
  );
};
