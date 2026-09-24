import { Header } from "@/components/shared/Header";
import { FirewallCockpitView } from "@/features/firewall/FirewallCockpitView";

export default function DashboardPage() {
  return (
    <div className="flex-1 flex flex-col">
      <Header
        title="Cockpit Pare-Feu & Conformité IA"
        description="Contrôle d'étanchéité active (Pass 1 Client & Pass 2 Enclave), protection PII et approbations en direct."
      />
      <div className="p-6 space-y-6 max-w-7xl w-full">
        <FirewallCockpitView />
      </div>
    </div>
  );
}
