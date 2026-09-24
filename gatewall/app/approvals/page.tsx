import { Header } from "@/components/shared/Header";
import { ApprovalsView } from "@/features/approvals/ApprovalsView";

export default function ApprovalsPage() {
  return (
    <div className="flex-1 flex flex-col">
      <Header
        title="Human-in-the-Loop Mission Control"
        description="Boîte de validation en temps réel des actions suspendues avec step.waitForApproval()."
      />
      <div className="p-8 space-y-6 max-w-7xl w-full">
        <ApprovalsView />
      </div>
    </div>
  );
}
