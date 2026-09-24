import { create } from "zustand";
import { SessionRun } from "@/lib/types/telemetry";

interface SessionStoreState {
  selectedSessionId: string | null;
  agentFilter: string;
  statusFilter: string;
  setSelectedSessionId: (id: string | null) => void;
  setAgentFilter: (agent: string) => void;
  setStatusFilter: (status: string) => void;
  applyRealtimeSession: (session: SessionRun) => void;
}

export const useSessionStore = create<SessionStoreState>((set) => ({
  selectedSessionId: "run-prospect-101",
  agentFilter: "ALL",
  statusFilter: "ALL",
  setSelectedSessionId: (id) => set({ selectedSessionId: id }),
  setAgentFilter: (agent) => set({ agentFilter: agent }),
  setStatusFilter: (status) => set({ statusFilter: status }),
  applyRealtimeSession: (session) => {
    set((state) => {
      if (state.selectedSessionId === session.runId) {
        return { selectedSessionId: session.runId };
      }
      return state;
    });
  },
}));
