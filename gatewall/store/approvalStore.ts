import { create } from "zustand";
import { ApprovalItem } from "@/lib/types/telemetry";

interface ApprovalStoreState {
  approvals: ApprovalItem[];
  setApprovals: (items: ApprovalItem[]) => void;
  updateApprovalStatus: (id: string, status: "APPROVED" | "REJECTED", reason?: string) => void;
}

export const useApprovalStore = create<ApprovalStoreState>((set) => ({
  approvals: [],
  setApprovals: (items) => set({ approvals: items }),
  updateApprovalStatus: (id, status, reason) => {
    set((state) => ({
      approvals: state.approvals.map((appr) =>
        appr.id === id
          ? {
              ...appr,
              status,
              reason,
              decidedAt: new Date().toISOString(),
              decidedBy: "You (Admin)",
            }
          : appr
      ),
    }));
  },
}));
