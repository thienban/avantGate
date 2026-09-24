import { Header } from "@/components/shared/Header";
import { SessionsView } from "@/features/sessions/SessionsView";

export default function SessionsPage() {
  return (
    <div className="flex-1 flex flex-col">
      <Header
        title="Session Replay & Timeline Graph"
        description="Magnétoscope d'exécution agentique pas-à-pas inspiré d'AgentOps."
      />
      <div className="p-8 max-w-7xl w-full">
        <SessionsView />
      </div>
    </div>
  );
}
