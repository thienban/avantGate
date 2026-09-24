"use client";

import React from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Table } from "@/components/ui/Table";
import { useMetricsQuery } from "@/hooks/useTelemetry";
import { formatCurrency, formatDuration } from "@/lib/utils";
import {
  Wrench,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react";

export const ToolsView: React.FC = () => {
  const { data, isLoading } = useMetricsQuery();

  if (isLoading || !data) {
    return (
      <div className="p-8 text-center text-zinc-400 text-sm">
        Chargement de la télémétrie des outils...
      </div>
    );
  }

  const { toolHealth } = data;

  return (
    <div className="space-y-6">
      {/* Overview Banner for Infinite Loop Shield */}
      <div className="p-4 rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/40 via-purple-950/20 to-zinc-950/40 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-indigo-500/20 border border-indigo-500/30 text-indigo-400">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              AgentOps Infinite Loop Shield
              <Badge variant="success">Actif (Seuil = 3 appels)</Badge>
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Analyse en continu les empreintes d&apos;outils pour couper net les agents tournant en boucle.
            </p>
          </div>
        </div>
      </div>

      {/* Tools Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {toolHealth.map((tool) => {
          const hasLoop = tool.loopShieldTriggers > 0;
          return (
            <Card
              key={tool.toolName}
              className={`p-5 transition-all ${
                hasLoop
                  ? "border-rose-500/40 bg-rose-950/10"
                  : "border-zinc-800/80 bg-zinc-950/70"
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-zinc-800 text-zinc-300">
                    <Wrench className="h-4 w-4" />
                  </div>
                  <h3 className="text-sm font-bold text-white font-mono">{tool.toolName}</h3>
                </div>
                {hasLoop ? (
                  <Badge variant="destructive">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {tool.loopShieldTriggers} Incident(s)
                  </Badge>
                ) : (
                  <Badge variant="success">100% Sain</Badge>
                )}
              </div>

              <div className="space-y-2 text-xs text-zinc-400 pt-2 border-t border-zinc-800/60">
                <div className="flex items-center justify-between">
                  <span>Exécutions totales :</span>
                  <span className="font-semibold text-zinc-200">{tool.totalExecutions}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Taux de succès :</span>
                  <span className="font-semibold text-emerald-400">{tool.successRate}%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Latence Moyenne :</span>
                  <span className="font-mono text-zinc-200">{formatDuration(tool.avgDurationMs)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Latence P95 :</span>
                  <span className="font-mono text-zinc-200">{formatDuration(tool.p95DurationMs)}</span>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-zinc-800/40">
                  <span>Coût cumulé :</span>
                  <span className="font-mono text-indigo-400 font-bold">
                    {formatCurrency(tool.totalCostUsd)}
                  </span>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Comprehensive Table */}
      <Card className="border-zinc-800/80 bg-zinc-950/70 p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Matrice de Fiabilité des Outils</h3>
        <Table>
          <thead>
            <tr className="border-b border-zinc-800 text-xs text-zinc-400">
              <th className="pb-3 font-medium">Nom de l&apos;Outil</th>
              <th className="pb-3 font-medium">Appels</th>
              <th className="pb-3 font-medium">Taux de Succès</th>
              <th className="pb-3 font-medium">Latence Moy.</th>
              <th className="pb-3 font-medium">Latence P95</th>
              <th className="pb-3 font-medium">Coût Total</th>
              <th className="pb-3 font-medium">Disjoncteur Boucle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60 text-xs">
            {toolHealth.map((tool) => (
              <tr key={tool.toolName} className="hover:bg-zinc-900/40">
                <td className="py-3 font-mono font-semibold text-zinc-200">{tool.toolName}</td>
                <td className="py-3 text-zinc-300">{tool.totalExecutions}</td>
                <td className="py-3">
                  <span className="text-emerald-400 font-medium">{tool.successRate}%</span>
                </td>
                <td className="py-3 font-mono text-zinc-400">{tool.avgDurationMs}ms</td>
                <td className="py-3 font-mono text-zinc-400">{tool.p95DurationMs}ms</td>
                <td className="py-3 font-mono text-indigo-400 font-semibold">
                  {formatCurrency(tool.totalCostUsd)}
                </td>
                <td className="py-3">
                  {tool.loopShieldTriggers > 0 ? (
                    <span className="text-rose-400 font-medium flex items-center gap-1">
                      <AlertTriangle className="h-3.5 w-3.5" /> Intercepté ({tool.loopShieldTriggers})
                    </span>
                  ) : (
                    <span className="text-emerald-400 font-medium flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Aucune anomalie
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
};
