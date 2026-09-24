"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Play, Shield, Activity } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { QUERY_KEYS } from "@/hooks/useTelemetry";

export interface HeaderProps {
  title: string;
  description?: string;
}

export const Header: React.FC<HeaderProps> = ({ title, description }) => {
  const [isSimulating, setIsSimulating] = useState(false);
  const [simMessage, setSimMessage] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const handleSimulateAgentRun = async () => {
    setIsSimulating(true);
    setSimMessage("Envoi télémétrie...");

    try {
      const sampleRunId = `run-sim-${Date.now().toString().slice(-4)}`;
      const payload = {
        runId: sampleRunId,
        agentName: "prospect-qualifier",
        timestamp: new Date().toISOString(),
        events: [
          {
            type: "STEP_START",
            stepName: "live-audit-step",
            timestamp: new Date().toISOString(),
          },
          {
            type: "TOOL_EXECUTION",
            toolId: `tool-${Date.now()}`,
            toolName: "searchCRM",
            aliasUsed: "crm_lookup",
            depth: 1,
            durationMs: 310,
            success: true,
            llmSummary: { status: "lead_identified", confidence: 0.94 },
            rawPayload: { email: "contact@enterprise.com", phone: "+33199887766" },
            piiFilteredCount: 2,
            tokens: { promptTokens: 140, completionTokens: 50, totalTokens: 190 },
            costUsd: 0.000085,
            cached: false,
            timestamp: new Date().toISOString(),
          },
          {
            type: "STEP_APPROVAL_REQUEST",
            stepName: "outreach-decision",
            actionType: "SEND_CAMPAIGN_EMAIL",
            payloadSummary: {
              targetAudience: "B2B SaaS Executives",
              estimatedDeal: "$75,000",
            },
            timestamp: new Date().toISOString(),
          },
        ],
        usage: {
          model: "gpt-4o-mini",
          promptTokens: 850,
          completionTokens: 210,
          totalTokens: 1060,
          costUsd: 0.0002535,
        },
      };

      const res = await fetch("/api/v1/ingest/events", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer ag_live_dev_test_key_123456789",
        },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setSimMessage("Événement ingéré !");
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.SESSIONS });
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.METRICS });
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.APPROVALS });
      } else {
        setSimMessage("Erreur d'envoi");
      }
    } catch {
      setSimMessage("Erreur réseau");
    } finally {
      setTimeout(() => {
        setIsSimulating(false);
        setSimMessage(null);
      }, 2500);
    }
  };

  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/40 px-8 py-4 backdrop-blur-md flex items-center justify-between">
      <div>
        <h1 className="text-xl font-bold text-white tracking-tight">{title}</h1>
        {description && <p className="text-xs text-zinc-400 mt-0.5">{description}</p>}
      </div>

      <div className="flex items-center gap-3">
        {/* Free Plan Badge */}
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-emerald-500/20 bg-emerald-950/20 text-xs font-mono text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Plan Free • 50k req/m</span>
        </div>

        {/* Security badge */}
        <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-500/20 bg-indigo-950/20 text-xs text-indigo-300">
          <Shield className="h-3.5 w-3.5 text-indigo-400" />
          <span>Isolation PII Active</span>
        </div>

        {/* Live Simulation button */}
        <Button
          variant="secondary"
          size="sm"
          onClick={handleSimulateAgentRun}
          disabled={isSimulating}
          className="border border-zinc-700 bg-zinc-900 text-xs hover:bg-zinc-800"
        >
          {isSimulating ? (
            <>
              <Activity className="h-3.5 w-3.5 animate-spin text-indigo-400" />
              <span>{simMessage || "Simulation..."}</span>
            </>
          ) : (
            <>
              <Play className="h-3.5 w-3.5 text-indigo-400 fill-indigo-400" />
              <span>Simuler un Run Télémétrique</span>
            </>
          )}
        </Button>
      </div>
    </header>
  );
};
