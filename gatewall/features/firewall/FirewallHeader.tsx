"use client";

import React from "react";
import { Badge } from "@/components/ui/Badge";
import { ShieldCheck, Radio, Lock, Zap } from "lucide-react";

interface FirewallHeaderProps {
  totalProtectedPii: number;
  totalClientAlerts: number;
  selectedRunId?: string;
}

export const FirewallHeader: React.FC<FirewallHeaderProps> = ({
  totalProtectedPii,
  totalClientAlerts,
}) => {
  return (
    <div className="p-5 rounded-2xl border border-emerald-500/30 bg-gradient-to-r from-emerald-50 via-teal-50/50 to-white dark:from-emerald-950/40 dark:via-zinc-900/80 dark:to-zinc-950/90 shadow-sm dark:shadow-xl dark:shadow-emerald-950/10 flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3.5">
        <div className="h-11 w-11 rounded-xl bg-emerald-100 dark:bg-emerald-500/20 border border-emerald-300 dark:border-emerald-500/40 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shadow-xs">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-base font-bold text-slate-900 dark:text-white tracking-tight">
              avantGate AI Firewall & Compliance Gateway
            </h1>
            <Badge variant="success" className="font-mono text-[11px] px-2 py-0.5">
              Zéro Fuite PII
            </Badge>
          </div>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5 flex items-center gap-2">
            <span>Passerelle $0-Infra</span>
            <span>•</span>
            <span className="text-emerald-700 dark:text-emerald-400 font-medium flex items-center gap-1">
              <Radio className="h-3 w-3 animate-pulse text-emerald-600 dark:text-emerald-400" />
              Ingress & Egress Shield Actifs (SSE: OK)
            </span>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-4 px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/80 text-xs font-mono shadow-xs dark:shadow-none">
          <div>
            <span className="text-slate-400 dark:text-zinc-500 block text-[10px]">PII PROTÉGÉES</span>
            <span className="text-emerald-700 dark:text-emerald-400 font-bold flex items-center gap-1">
              <Lock className="h-3 w-3" />
              {totalProtectedPii}
            </span>
          </div>
          <div className="border-l border-slate-200 dark:border-zinc-800 pl-3">
            <span className="text-slate-400 dark:text-zinc-500 block text-[10px]">ALERTES PASS 1</span>
            <span className="text-amber-700 dark:text-amber-400 font-bold flex items-center gap-1">
              <Zap className="h-3 w-3" />
              {totalClientAlerts}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
