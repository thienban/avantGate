import { Header } from "@/components/shared/Header";
import { SecurityView } from "@/features/security/SecurityView";

export default function SecurityPage() {
  return (
    <div className="flex-1 flex flex-col">
      <Header
        title="Inspecteur Double-Canal PII"
        description="Contrôle d'étanchéité active en enclave locale et preuve d'absence de fuite de données vers les LLMs."
      />
      <div className="p-8 space-y-6 max-w-7xl w-full">
        <SecurityView />
      </div>
    </div>
  );
}
