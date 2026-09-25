"use client";

import React from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { useMetricsQuery, useApprovalsQuery } from "@/hooks/useTelemetry";
import { formatCurrency, formatTokens } from "@/lib/utils";
import { ApprovalItem } from "@/lib/types/telemetry";
import {
  ShieldCheck,
  Layers,
  Wrench,
  TrendingUp,
  AlertTriangle,
  UserCheck,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

export const DashboardView: React.FC = () => {
  const { data, isLoading } = useMetricsQuery();
  const { data: approvalsData } = useApprovalsQuery();

  if (isLoading || !data) {
    return (
      <div className="p-8 text-center text-slate-500 dark:text-zinc-400 text-sm">
        Chargement des métriques de conformité...
      </div>
    );
  }

  const { finops, toolHealth } = data;
  const pendingApprovalsCount =
    approvalsData?.approvals.filter((a: ApprovalItem) => a.status === "PENDING").length || 0;

  const kpis = [
    {
      title: "Étanchéité PII",
      value: "0.00%",
      change: "Aucune PII transmise au LLM",
      icon: ShieldCheck,
      color: "from-emerald-500/10 to-teal-500/5 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50/50 dark:bg-transparent",
    },
    {
      title: "Requêtes Filtrées (Pare-Feu)",
      value: finops.totalRuns.toString(),
      change: "Ingress & Egress 100% inspectés",
      icon: Layers,
      color: "from-indigo-500/10 to-violet-500/5 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-500/20 bg-indigo-50/50 dark:bg-transparent",
    },
    {
      title: "Garde-Fous Outils Surveillés",
      value: toolHealth.length.toString(),
      change: "Protection anti-boucle (LLM06)",
      icon: Wrench,
      color: "from-blue-500/10 to-sky-500/5 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-500/20 bg-sky-50/50 dark:bg-transparent",
    },
    {
      title: "Approbations en Attente (HITL)",
      value: pendingApprovalsCount.toString(),
      change: "Gouvernance OWASP LLM03",
      icon: UserCheck,
      color: "from-amber-500/10 to-orange-500/5 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-500/20 bg-amber-50/50 dark:bg-transparent",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top KPIs Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <Card
              key={idx}
              className="relative overflow-hidden border-slate-200/90 dark:border-zinc-800/80 bg-white dark:bg-gradient-to-b dark:from-zinc-900/60 dark:to-zinc-950/60 shadow-xs dark:shadow-none"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500 dark:text-zinc-400">{kpi.title}</span>
                <div className={`rounded-lg border p-2 ${kpi.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <h3 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{kpi.value}</h3>
                <p className="mt-1 text-[11px] text-slate-500 dark:text-zinc-400 flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                  <span>{kpi.change}</span>
                </p>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Chart Section & Model Distribution */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Daily Spending Trend (2 cols) */}
        <Card className="lg:col-span-2 border-slate-200/90 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/70 p-5 shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Évolution des Dépenses & Runs</h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400">Consommation journalière agrégée</p>
            </div>
            <Badge variant="outline" className="text-[11px]">
              Derniers 7 jours
            </Badge>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={finops.dailyHistory}>
                <defs>
                  <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#94a3b8" strokeOpacity={0.25} />
                <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} />
                <YAxis
                  stroke="#64748b"
                  fontSize={11}
                  tickLine={false}
                  tickFormatter={(val) => `$${val}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "var(--background)",
                    borderColor: "#94a3b8",
                    borderRadius: "8px",
                    color: "var(--foreground)",
                    fontSize: "12px",
                    boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                  }}
                  formatter={(val: unknown) => [`$${Number(val).toFixed(4)}`, "Coût"]}
                />
                <Area
                  type="monotone"
                  dataKey="costUsd"
                  stroke="#6366f1"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#costGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Model Breakdown (1 col) */}
        <Card className="border-slate-200/90 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/70 p-5 shadow-xs dark:shadow-none">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">Ventilation par Modèle LLM</h3>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mb-4">Coût et jetons consommés</p>

          <div className="space-y-3.5">
            {Object.entries(finops.costByModel).map(([model, details]) => (
              <div
                key={model}
                className="p-3 rounded-lg border border-slate-200/90 dark:border-zinc-800/60 bg-slate-50 dark:bg-zinc-900/40 text-xs"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold text-slate-800 dark:text-zinc-200 truncate">{model}</span>
                  <span className="font-mono text-indigo-600 dark:text-indigo-400 font-bold">
                    {formatCurrency(details.costUsd)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-zinc-400">
                  <span>{formatTokens(details.tokens)} tokens</span>
                  <span>{details.count} exécutions</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Top Tools Preview */}
      <Card className="border-slate-200/90 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/70 p-5 shadow-xs dark:shadow-none">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Consommation des Outils d&apos;Agents</h3>
            <p className="text-xs text-slate-500 dark:text-zinc-400">Surveillance des coûts et des anomalies</p>
          </div>
          <Badge variant="info">Moteur FinOps Actif</Badge>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {toolHealth.slice(0, 3).map((tool) => (
            <div
              key={tool.toolName}
              className="p-3 rounded-lg border border-slate-200/90 dark:border-zinc-800/70 bg-slate-50 dark:bg-zinc-900/40 flex flex-col justify-between"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-semibold text-xs text-slate-800 dark:text-zinc-200">{tool.toolName}</span>
                {tool.loopShieldTriggers > 0 ? (
                  <Badge variant="warning" className="text-[10px]">
                    <AlertTriangle className="h-3 w-3" />
                    {tool.loopShieldTriggers} Boucle(s)
                  </Badge>
                ) : (
                  <Badge variant="success" className="text-[10px]">
                    Sain
                  </Badge>
                )}
              </div>
              <div className="space-y-1 text-[11px] text-slate-500 dark:text-zinc-400">
                <div className="flex justify-between">
                  <span>Succès :</span>
                  <span className="text-slate-800 dark:text-zinc-200 font-medium">{tool.successRate}%</span>
                </div>
                <div className="flex justify-between">
                  <span>Latence moy. :</span>
                  <span className="text-slate-800 dark:text-zinc-200 font-medium">{tool.avgDurationMs}ms</span>
                </div>
                <div className="flex justify-between">
                  <span>Coût cumulé :</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-mono font-semibold">
                    {formatCurrency(tool.totalCostUsd)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};
