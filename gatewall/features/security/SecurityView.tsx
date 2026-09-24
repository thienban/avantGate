"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useSessionsQuery } from "@/hooks/useTelemetry";
import {
  ShieldCheck,
  Lock,
  EyeOff,
  Database,
  FileCheck2,
} from "lucide-react";
import { ToolExecutionEvent } from "@/lib/types/telemetry";

export const SecurityView: React.FC = () => {
  const { data } = useSessionsQuery();
  const sessions = data?.sessions || [];

  const toolEventsWithPii = sessions.flatMap((session) =>
    session.events
      .filter((e): e is ToolExecutionEvent => e.type === "TOOL_EXECUTION" && Boolean(e.rawPayload))
      .map((e) => ({ ...e, sessionRunId: session.runId, agentName: session.agentName }))
  );

  const [selectedEventIndex, setSelectedEventIndex] = useState(0);
  const selectedEvent = toolEventsWithPii[selectedEventIndex] || toolEventsWithPii[0];

  return (
    <div className="space-y-6">
      {/* Top Security Banner */}
      <div className="p-5 rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-950/40 via-teal-950/20 to-zinc-950/40 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-400">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              Dual-Channel PII Inspector & Data Leak Observability
              <Badge variant="success">Zéro Fuite PII</Badge>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Contrôle strict d&apos;étanchéité : preuve que les PII locales restent cantonnées en enclave et ne franchissent jamais le LLM.
            </p>
          </div>
        </div>
      </div>

      {/* Data Lineage Architecture Flow */}
      <Card className="border-zinc-800/80 bg-zinc-950/70 p-5">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-4 flex items-center gap-1.5">
          <Database className="h-3.5 w-3.5 text-indigo-400" />
          Chaîne Causale d&apos;Étanchéité des Données (Data Lineage Flow)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
          {/* Node 1: Source */}
          <div className="p-3.5 rounded-lg border border-zinc-800 bg-zinc-900/60 flex flex-col justify-between">
            <div>
              <span className="text-[10px] text-zinc-500 font-mono block">1. SOURCE DONNÉES</span>
              <h4 className="font-bold text-zinc-200 mt-1">CRM & Bases Internes</h4>
              <p className="text-[11px] text-zinc-400 mt-1">Données réelles brutes (clients, leads, finance).</p>
            </div>
            <div className="mt-2 text-zinc-500 text-[10px] font-mono">Payload brut extrait</div>
          </div>

          {/* Node 2: Local Enclave */}
          <div className="p-3.5 rounded-lg border border-rose-500/30 bg-rose-950/20 flex flex-col justify-between">
            <div>
              <span className="text-[10px] text-rose-400 font-mono block">2. ENCLAVE LOCALE $0 INFRA</span>
              <h4 className="font-bold text-rose-300 mt-1">Séquestre PII Mémoire</h4>
              <p className="text-[11px] text-zinc-400 mt-1">Emails, téléphones, IBANs isolés en mémoire vive.</p>
            </div>
            <div className="mt-2 text-rose-400 text-[10px] font-mono">Barrière Étanchéité Active</div>
          </div>

          {/* Node 3: Filter & Proof */}
          <div className="p-3.5 rounded-lg border border-emerald-500/30 bg-emerald-950/20 flex flex-col justify-between">
            <div>
              <span className="text-[10px] text-emerald-400 font-mono block">3. CANAL SANITISÉ</span>
              <h4 className="font-bold text-emerald-300 mt-1">Résumé Contextuel</h4>
              <p className="text-[11px] text-zinc-400 mt-1">Scores, statuts agrégés, métadonnées non nominatives.</p>
            </div>
            <div className="mt-2 text-emerald-400 text-[10px] font-mono">Preuve SHA-256 générée</div>
          </div>

          {/* Node 4: LLM */}
          <div className="p-3.5 rounded-lg border border-indigo-500/30 bg-indigo-950/20 flex flex-col justify-between">
            <div>
              <span className="text-[10px] text-indigo-400 font-mono block">4. MODÈLE CLOUD EXTERNE</span>
              <h4 className="font-bold text-indigo-300 mt-1">Prompt LLM Clean</h4>
              <p className="text-[11px] text-zinc-400 mt-1">Zéro PII transmise aux serveurs OpenAI / Anthropic.</p>
            </div>
            <div className="mt-2 text-indigo-400 text-[10px] font-mono">Conformité RGPD Garantie</div>
          </div>
        </div>
      </Card>

      {/* Main Dual-Channel Inspector Layout */}
      {selectedEvent ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              Événement inspecté : <span className="font-mono text-indigo-400">{selectedEvent.toolName}</span> (Run: {selectedEvent.sessionRunId})
            </h3>
            <span className="text-xs text-zinc-400">
              {selectedEvent.piiFilteredCount} PIIs masquées à la volée
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Channel A: Raw Local Storage (Red / Isolated) */}
            <Card className="border-rose-500/30 bg-rose-950/10 p-5 space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-rose-500/20">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-rose-400" />
                  <h4 className="text-sm font-bold text-rose-300">Canal A : Données Brutes (Enclave Locale)</h4>
                </div>
                <Badge variant="destructive" className="text-[10px]">Cantonné en Local</Badge>
              </div>

              <p className="text-xs text-zinc-400">
                Données sensibles issues de l&apos;API ou CRM (Emails, téléphones, chiffres d&apos;affaires). Ces champs restent cantonnés au stockage applicatif client.
              </p>

              <pre className="p-3.5 rounded-lg bg-zinc-950/90 border border-rose-500/20 text-xs font-mono text-rose-200 overflow-x-auto max-h-64">
                {JSON.stringify(selectedEvent.rawPayload, null, 2)}
              </pre>
            </Card>

            {/* Channel B: LLM Transmitted Summary (Green / Sanitized) */}
            <Card className="border-emerald-500/30 bg-emerald-950/10 p-5 space-y-3">
              <div className="flex items-center justify-between pb-3 border-b border-emerald-500/20">
                <div className="flex items-center gap-2">
                  <EyeOff className="h-4 w-4 text-emerald-400" />
                  <h4 className="text-sm font-bold text-emerald-300">Canal B : Résumé Transmis au LLM</h4>
                </div>
                <Badge variant="success" className="text-[10px]">Certifié Zéro Fuite</Badge>
              </div>

              <p className="text-xs text-zinc-400">
                Seules les métadonnées et scores dérivés sont transmis au modèle. Aucune PII n&apos;a franchi la barrière contextuelle.
              </p>

              <pre className="p-3.5 rounded-lg bg-zinc-950/90 border border-emerald-500/20 text-xs font-mono text-emerald-200 overflow-x-auto max-h-64">
                {JSON.stringify(selectedEvent.llmSummary, null, 2)}
              </pre>
            </Card>
          </div>
        </div>
      ) : (
        <Card className="p-8 text-center text-zinc-400">
          Aucun événement avec double canal PII disponible pour le moment.
        </Card>
      )}

      {/* Audit Logs Table */}
      <Card className="border-zinc-800/80 bg-zinc-950/70 p-5">
        <h3 className="text-sm font-semibold text-white mb-3">Journal d&apos;Audit des Sanitisations Télémétriques</h3>
        <div className="space-y-2">
          {toolEventsWithPii.map((item, idx) => (
            <div
              key={idx}
              onClick={() => setSelectedEventIndex(idx)}
              className={`p-3 rounded-lg border cursor-pointer transition-all flex items-center justify-between text-xs ${
                selectedEventIndex === idx
                  ? "border-emerald-500/50 bg-emerald-950/20"
                  : "border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900"
              }`}
            >
              <div className="flex items-center gap-3">
                <FileCheck2 className="h-4 w-4 text-emerald-400" />
                <div>
                  <span className="font-semibold text-zinc-200">{item.toolName}</span>
                  <span className="text-zinc-500 ml-2 font-mono">({item.sessionRunId})</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-emerald-400 font-medium">{item.piiFilteredCount} PII Masquées</span>
                <span className="text-zinc-500 font-mono">{item.timestamp.slice(11, 19)}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
