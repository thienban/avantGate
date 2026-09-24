import { Header } from "@/components/shared/Header";
import { ToolsView } from "@/features/tools/ToolsView";

export default function ToolsPage() {
  return (
    <div className="flex-1 flex flex-col">
      <Header
        title="Santé des Outils & Disjoncteur Loop Shield"
        description="Surveillance des latences P95, taux d'échec et détection des boucles répétitives."
      />
      <div className="p-8 space-y-6 max-w-7xl w-full">
        <ToolsView />
      </div>
    </div>
  );
}
