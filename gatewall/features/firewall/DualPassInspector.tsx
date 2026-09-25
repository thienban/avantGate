"use client";

import React from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import {
  SessionRun,
  ToolExecutionEvent,
  ClientSecurityAlertEvent,
  ClientDataRenderedEvent,
} from "@/lib/types/telemetry";
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  EyeOff,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  MonitorCheck,
} from "lucide-react";

interface DualPassInspectorProps {
  session: SessionRun;
}

export const DualPassInspector: React.FC<DualPassInspectorProps> = ({ session }) => {
  const clientAlerts = session.events.filter(
    (e): e is ClientSecurityAlertEvent => e.type === "CLIENT_SECURITY_ALERT"
  );
  const clientRenders = session.events.filter(
    (e): e is ClientDataRenderedEvent => e.type === "CLIENT_DATA_RENDERED"
  );
  const toolWithPii = session.events.find(
    (e): e is ToolExecutionEvent => e.type === "TOOL_EXECUTION" && Boolean(e.rawPayload)
  );

  return (
    <div className="space-y-4">
      {/* PASS 1: Browser Pre-Flight & Client Telemetry (FEAT-011) */}
      <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-indigo-50/50 dark:bg-gradient-to-r dark:from-indigo-950/30 dark:via-zinc-900/60 dark:to-zinc-950/60 space-y-3 shadow-xs dark:shadow-none">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-200 dark:border-indigo-500/20 pb-2">
          <div className="flex items-center gap-2">
            <MonitorCheck className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
              Pass 1 : Client-Side Pre-Flight Check & Événements Navigateur (FEAT-011)
            </h3>
          </div>
          <Badge variant="outline" className="text-[10px] text-indigo-700 dark:text-indigo-300 border-indigo-300 dark:border-indigo-500/40">
            Auth: gw_pub_...
          </Badge>
        </div>

        {/* Client Security Alerts if any */}
        {clientAlerts.length > 0 ? (
          <div className="space-y-2">
            {clientAlerts.map((alert, idx) => (
              <div
                key={idx}
                className="p-3 rounded-lg border border-rose-300 dark:border-rose-500/40 bg-rose-50 dark:bg-rose-950/30 flex items-start gap-2.5 text-xs text-rose-900 dark:text-rose-200"
              >
                <ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">
                      Menace Interceptée dans le Navigateur : {alert.alertType}
                    </span>
                    <span className="text-[10px] text-rose-600 dark:text-rose-400 font-mono">
                      {alert.timestamp.slice(11, 19)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-zinc-300">
                    Saisie bloquée avant tout départ réseau : longueur de {alert.inputLength} caractères.
                    {alert.matchedPatternSnippet && (
                      <span className="font-mono ml-1 text-rose-800 dark:text-rose-300 bg-rose-100 dark:bg-rose-950/60 px-1 py-0.5 rounded border border-rose-200 dark:border-rose-500/30">
                        Snippet : {alert.matchedPatternSnippet}
                      </span>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-slate-600 dark:text-zinc-400 flex items-center gap-2 py-1">
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <span>Aucune menace ou injection détectée lors de la saisie utilisateur.</span>
          </div>
        )}

        {/* Client Data Rendered (toClientData) & Feedback row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {clientRenders.length > 0 ? (
            <div className="p-3 rounded-lg border border-cyan-200 dark:border-cyan-500/30 bg-cyan-50 dark:bg-cyan-950/20 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-cyan-800 dark:text-cyan-300 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
                  Rendu Out-of-Band (`toClientData`)
                </span>
                <Badge variant="info" className="text-[9px]">
                  Canal {clientRenders[0].channel}
                </Badge>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-zinc-300">
                {clientRenders.reduce((acc, r) => acc + (r.renderedItemCount || 0), 0)} fiches contacts
                affichées dans l&apos;UI sans passer par le LLM.
              </p>
            </div>
          ) : (
            <div className="p-3 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/40 text-xs text-slate-500 dark:text-zinc-500">
              Aucun rendu de données directes sur ce run.
            </div>
          )}

          {session.userFeedback ? (
            <div className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/20 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                  {session.userFeedback.rating === "POSITIVE" ? (
                    <ThumbsUp className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <ThumbsDown className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                  )}
                  Feedback Commercial : {session.userFeedback.rating}
                </span>
                {session.userFeedback.tag && (
                  <Badge variant="outline" className="text-[9px] text-emerald-800 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30">
                    {session.userFeedback.tag}
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-slate-600 dark:text-zinc-300 italic">
                &ldquo;{session.userFeedback.comment || "Aucun commentaire"}&rdquo;
              </p>
            </div>
          ) : (
            <div className="p-3 rounded-lg border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/40 text-xs text-slate-500 dark:text-zinc-500">
              En attente d&apos;évaluation par le commercial.
            </div>
          )}
        </div>
      </div>

      {/* PASS 2: Enclave Ingress/Egress Shield (Backend Dual-Channel) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-700 dark:text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            Pass 2 : Enclave Ingress / Egress Shield & Inspecteur Dual-Channel
          </h3>
          <Badge variant="success" className="text-[10px]">
            {session.piiFilteredCount} PII Masquées
          </Badge>
        </div>

        {toolWithPii ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Channel A: Raw Local Data (Red / Enclave) */}
            <Card className="border-rose-200 dark:border-rose-500/30 bg-rose-50/50 dark:bg-rose-950/10 p-4 space-y-2 rounded-xl shadow-xs dark:shadow-none">
              <div className="flex items-center justify-between border-b border-rose-200 dark:border-rose-500/20 pb-2">
                <div className="flex items-center gap-1.5">
                  <Lock className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                  <h4 className="text-xs font-bold text-rose-800 dark:text-rose-300">
                    Canal A : Données Brutes (Séquestre Enclave)
                  </h4>
                </div>
                <Badge variant="destructive" className="text-[9px]">
                  Cantonné en Local
                </Badge>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-zinc-400">
                Emails directs, téléphones portables et chiffres d&apos;affaires extraits du CRM.
              </p>
              <pre className="p-3 rounded-lg bg-slate-900 border border-slate-800 dark:bg-zinc-950/90 dark:border-rose-500/20 text-[11px] font-mono text-rose-300 overflow-x-auto max-h-44">
                {JSON.stringify(toolWithPii.rawPayload, null, 2)}
              </pre>
            </Card>

            {/* Channel B: Sanitized Summary for LLM (Green / Zero Leak) */}
            <Card className="border-emerald-200 dark:border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/10 p-4 space-y-2 rounded-xl shadow-xs dark:shadow-none">
              <div className="flex items-center justify-between border-b border-emerald-200 dark:border-emerald-500/20 pb-2">
                <div className="flex items-center gap-1.5">
                  <EyeOff className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  <h4 className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                    Canal B : Résumé Transmis au LLM (Zero Leak)
                  </h4>
                </div>
                <Badge variant="success" className="text-[9px]">
                  Certifié Zéro Fuite
                </Badge>
              </div>
              <p className="text-[11px] text-slate-600 dark:text-zinc-400">
                Seules les métadonnées et scores d&apos;adéquation ont été transmis à OpenAI / Claude.
              </p>
              <pre className="p-3 rounded-lg bg-slate-900 border border-slate-800 dark:bg-zinc-950/90 dark:border-emerald-500/20 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-44">
                {JSON.stringify(toolWithPii.llmSummary, null, 2)}
              </pre>
            </Card>
          </div>
        ) : (
          <Card className="p-5 text-center text-xs text-slate-500 dark:text-zinc-500 rounded-xl border border-slate-200 bg-white dark:border-zinc-800 dark:bg-zinc-900/30 shadow-xs dark:shadow-none">
            Cet agent n&apos;a pas manipulé de charges PII brutes sur cette étape.
          </Card>
        )}
      </div>
    </div>
  );
};
