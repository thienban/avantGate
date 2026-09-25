"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  History,
  ShieldCheck,
  Zap,
  Radio,
  Coins,
  UserCheck,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useApprovalsQuery } from "@/hooks/useTelemetry";

export const Sidebar: React.FC = () => {
  const pathname = usePathname();
  const { data: approvalsData } = useApprovalsQuery();

  const pendingApprovalsCount =
    approvalsData?.approvals.filter((a) => a.status === "PENDING").length || 0;

  const navigationItems = [
    {
      name: "Cockpit Pare-Feu & IA",
      href: "/dashboard",
      icon: ShieldCheck,
      badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
    },
    {
      name: "Journal d'Audit & Replay",
      href: "/sessions",
      icon: History,
    },
    {
      name: "Inspecteur PII",
      href: "/security",
      icon: LayoutDashboard,
    },
    {
      name: "Validation Human-in-Loop",
      href: "/approvals",
      icon: UserCheck,
      badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
    },
    {
      name: "Santé Outils & Boucles",
      href: "/tools",
      icon: Wrench,
    },
    {
      name: "Tarification FinOps",
      href: "/pricing",
      icon: Coins,
    },
  ];

  return (
    <aside className="w-64 border-r border-slate-200/90 dark:border-zinc-800/80 bg-white/95 dark:bg-zinc-950/80 flex flex-col justify-between p-4 backdrop-blur-xl shrink-0 transition-colors">
      <div>
        {/* Brand */}
        <div className="flex items-center gap-3 px-2 py-3 mb-6">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <span className="font-bold text-base tracking-tight text-slate-900 dark:text-white flex items-center gap-1.5">
              gateWall
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300 font-semibold border border-emerald-200 dark:border-emerald-500/30">
                FREE
              </span>
            </span>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400">AI Compliance & Firewall</p>
          </div>
        </div>

        {/* Live Ingestion Indicator */}
        <div className="mx-2 mb-6 p-2.5 rounded-lg border border-emerald-500/20 bg-emerald-50 dark:bg-emerald-950/20 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
            <Radio className="h-3.5 w-3.5 animate-pulse text-emerald-600 dark:text-emerald-400" />
            <span>Passerelle Active</span>
          </div>
          <span className="text-[10px] text-emerald-700/80 dark:text-emerald-400/80 font-mono">SSE: OK</span>
        </div>

        {/* Nav Links */}
        <nav className="space-y-1">
          {navigationItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-all group",
                  isActive
                    ? "bg-indigo-50 text-indigo-700 border border-indigo-200/80 shadow-xs dark:bg-indigo-600/15 dark:text-indigo-400 dark:border-indigo-500/20"
                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-zinc-400 dark:hover:text-zinc-200 dark:hover:bg-zinc-900/60"
                )}
              >
                <div className="flex items-center gap-3">
                  <Icon
                    className={cn(
                      "h-4 w-4 transition-colors",
                      isActive ? "text-indigo-600 dark:text-indigo-400" : "text-slate-400 group-hover:text-slate-700 dark:text-zinc-400 dark:group-hover:text-zinc-200"
                    )}
                  />
                  <span>{item.name}</span>
                </div>
                {item.badge !== undefined && (
                  <span className="px-1.5 py-0.5 text-[11px] font-bold rounded-full bg-rose-500 text-white animate-pulse">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer Info - Free Plan */}
      <div className="p-3 rounded-xl border border-slate-200 dark:border-zinc-800/80 bg-slate-50 dark:bg-zinc-900/40 text-xs text-slate-600 dark:text-zinc-400 space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="font-medium text-slate-800 dark:text-zinc-300">Workspace Local</p>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/20 font-mono">
            1 dev
          </span>
        </div>
        <div className="text-[11px] text-slate-500 dark:text-zinc-400 font-mono flex items-center justify-between">
          <span>Quota Free</span>
          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">50k req / mois</span>
        </div>
        <p className="text-[10px] text-slate-400 dark:text-zinc-500 pt-1 border-t border-slate-200 dark:border-zinc-800/60">Formule Free Developer</p>
      </div>
    </aside>
  );
};
