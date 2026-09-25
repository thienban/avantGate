"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ModelPricingItem } from "@/lib/types/pricing";
import { X, DollarSign, Sparkles } from "lucide-react";

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<ModelPricingItem, "updatedAt">) => Promise<void>;
  initialData?: ModelPricingItem | null;
}

interface PricingFormProps {
  initialData?: ModelPricingItem | null;
  onClose: () => void;
  onSubmit: (data: Omit<ModelPricingItem, "updatedAt">) => Promise<void>;
}

const PricingForm: React.FC<PricingFormProps> = ({ initialData, onClose, onSubmit }) => {
  const [provider, setProvider] = useState(initialData?.provider ?? "deepseek");
  const [model, setModel] = useState(initialData?.model ?? "");
  const [promptUSDPerMillion, setPromptUSDPerMillion] = useState(
    initialData?.promptUSDPerMillion !== undefined ? initialData.promptUSDPerMillion.toString() : ""
  );
  const [completionUSDPerMillion, setCompletionUSDPerMillion] = useState(
    initialData?.completionUSDPerMillion !== undefined ? initialData.completionUSDPerMillion.toString() : ""
  );
  const [cacheHitUSDPerMillion, setCacheHitUSDPerMillion] = useState(
    initialData?.cacheHitUSDPerMillion !== undefined ? initialData.cacheHitUSDPerMillion.toString() : ""
  );
  const [isActive, setIsActive] = useState(initialData?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const promptVal = parseFloat(promptUSDPerMillion);
    const completionVal = parseFloat(completionUSDPerMillion);
    const cacheHitVal = cacheHitUSDPerMillion ? parseFloat(cacheHitUSDPerMillion) : undefined;

    if (!provider.trim() || !model.trim()) {
      setError("Le fournisseur et le modèle sont obligatoires.");
      return;
    }

    if (isNaN(promptVal) || promptVal < 0 || isNaN(completionVal) || completionVal < 0) {
      setError("Les coûts Prompt et Completion doivent être des nombres positifs ou nuls.");
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        provider: provider.trim().toLowerCase(),
        model: model.trim().toLowerCase(),
        promptUSDPerMillion: promptVal,
        completionUSDPerMillion: completionVal,
        cacheHitUSDPerMillion: cacheHitVal,
        isActive,
      });
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Erreur inattendue lors de la sauvegarde.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="p-6 space-y-4">
      {error && (
        <div className="p-3 text-xs rounded-lg border border-rose-300 dark:border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 text-rose-800 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block mb-1.5 text-xs font-medium text-slate-700 dark:text-zinc-300">
            Fournisseur
          </label>
          <Input
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            placeholder="ex: deepseek, openai, mistral"
            disabled={Boolean(initialData)}
            required
          />
        </div>
        <div>
          <label className="block mb-1.5 text-xs font-medium text-slate-700 dark:text-zinc-300">
            Modèle (identifiant)
          </label>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="ex: deepseek-chat, gpt-4o"
            disabled={Boolean(initialData)}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block mb-1.5 text-xs font-medium text-slate-700 dark:text-zinc-300">
            Prompt ($ / 1M tokens)
          </label>
          <Input
            type="number"
            step="0.0001"
            min="0"
            value={promptUSDPerMillion}
            onChange={(e) => setPromptUSDPerMillion(e.target.value)}
            placeholder="0.14"
            required
          />
        </div>
        <div>
          <label className="block mb-1.5 text-xs font-medium text-slate-700 dark:text-zinc-300">
            Completion ($ / 1M tokens)
          </label>
          <Input
            type="number"
            step="0.0001"
            min="0"
            value={completionUSDPerMillion}
            onChange={(e) => setCompletionUSDPerMillion(e.target.value)}
            placeholder="0.28"
            required
          />
        </div>
      </div>

      <div>
        <label className="block mb-1.5 text-xs font-medium text-slate-700 dark:text-zinc-300 flex items-center justify-between">
          <span>Cache Hit Discount ($ / 1M tokens)</span>
          <span className="text-[10px] text-slate-400 dark:text-zinc-400 font-normal">Optionnel</span>
        </label>
        <Input
          type="number"
          step="0.0001"
          min="0"
          value={cacheHitUSDPerMillion}
          onChange={(e) => setCacheHitUSDPerMillion(e.target.value)}
          placeholder="ex: 0.014"
        />
      </div>

      <div className="flex items-center gap-3 pt-2">
        <input
          type="checkbox"
          id="isActive"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="w-4 h-4 rounded border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-indigo-600 focus:ring-indigo-500"
        />
        <label htmlFor="isActive" className="text-xs text-slate-700 dark:text-zinc-300 cursor-pointer select-none">
          Modèle actif pour l&apos;estimation et les gardes-fous budgétaires
        </label>
      </div>

      {/* Footer actions */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200 dark:border-zinc-800">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Annuler
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={isSubmitting}>
          <Sparkles className="w-3.5 h-3.5" />
          {isSubmitting ? "Enregistrement..." : initialData ? "Mettre à jour" : "Ajouter au catalogue"}
        </Button>
      </div>
    </form>
  );
};

export const PricingModal: React.FC<PricingModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  initialData,
}) => {
  if (!isOpen) return null;

  const formKey = initialData ? `${initialData.provider}/${initialData.model}` : "new";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 dark:bg-black/75 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-lg overflow-hidden border rounded-2xl border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/50">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:border-indigo-500/20">
              <DollarSign className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                {initialData ? "Modifier le Tarif" : "Ajouter un Modèle"}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-400">Barème financier par million de jetons</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:text-zinc-400 dark:hover:text-white dark:hover:bg-zinc-800/80 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Dynamic Keyed Form to avoid cascading render effects */}
        <PricingForm
          key={formKey}
          initialData={initialData}
          onClose={onClose}
          onSubmit={onSubmit}
        />
      </div>
    </div>
  );
};
