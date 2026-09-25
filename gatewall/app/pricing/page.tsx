import { Header } from "@/components/shared/Header";
import { PricingView } from "@/features/pricing/PricingView";

const PricingPage: React.FC = () => {
  return (
    <div className="flex-1 flex flex-col">
      <Header
        title="Gouvernance FinOps & Tarification"
        description="Configuration et persistance des barèmes financiers de modèles LLM dans SQLite avec 0 ms d'overhead."
      />
      <div className="p-8 space-y-6 max-w-7xl w-full">
        <PricingView />
      </div>
    </div>
  );
};

export default PricingPage;
