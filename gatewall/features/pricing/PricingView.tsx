"use client";

import React, { useState, useMemo } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  usePricingQuery,
  useUpsertPriceMutation,
  useDeletePriceMutation,
  useSeedPricingMutation,
} from "@/hooks/usePricing";
import { ModelPricingItem } from "@/lib/types/pricing";
import { PricingModal } from "./PricingModal";
import {
  Plus,
  RotateCcw,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  Pencil,
  Trash2,
  Coins,
  Cpu,
  TrendingDown,
} from "lucide-react";

export const PricingView: React.FC = () => {
  const { data, isLoading, error } = usePricingQuery();
  const upsertMutation = useUpsertPriceMutation();
  const deleteMutation = useDeletePriceMutation();
  const seedMutation = useSeedPricingMutation();

  const [search, setSearch] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<string>("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ModelPricingItem | null>(null);

  const pricingList = useMemo(() => data?.pricing || [], [data?.pricing]);

  const providers = useMemo(() => {
    const set = new Set(pricingList.map((p) => p.provider));
    return Array.from(set);
  }, [pricingList]);

  const filteredPricing = useMemo(() => {
    return pricingList.filter((item) => {
      const matchesSearch =
        item.model.toLowerCase().includes(search.toLowerCase()) ||
        item.provider.toLowerCase().includes(search.toLowerCase());
      const matchesProvider =
        selectedProvider === "all" || item.provider.toLowerCase() === selectedProvider.toLowerCase();
      return matchesSearch && matchesProvider;
    });
  }, [pricingList, search, selectedProvider]);

  const cheapestModel = useMemo(() => {
    if (pricingList.length === 0) return null;
    return [...pricingList].sort((a, b) => a.promptUSDPerMillion - b.promptUSDPerMillion)[0];
  }, [pricingList]);

  const handleOpenAdd = () => {
    setEditingItem(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (item: ModelPricingItem) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleDelete = async (provider: string, model: string) => {
    if (confirm(`Confirmez-vous la suppression du tarif pour '${provider}/${model}' ?`)) {
      await deleteMutation.mutateAsync({ provider, model });
    }
  };

  const handleSeed = async () => {
    if (confirm("Voulez-vous réinitialiser le catalogue avec les tarifs officiels par défaut ?")) {
      await seedMutation.mutateAsync(true);
    }
  };

  const handleSavePrice = async (item: Omit<ModelPricingItem, "updatedAt">) => {
    await upsertMutation.mutateAsync(item);
  };

  if (isLoading) {
    return (
      <div className="p-8 text-center text-zinc-400 text-sm">
        Chargement des barèmes FinOps...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-rose-400 text-sm">
        Erreur lors du chargement des tarifs : {error.message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
            <Coins className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            Grille Tarifaire FinOps & LLM
          </h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
            Persistance locale SQLite partagée entre les agents d&apos;inférence et la console de supervision
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleSeed}
            disabled={seedMutation.isPending}
            className="text-xs border-slate-200 dark:border-zinc-800 hover:bg-slate-100 dark:hover:bg-zinc-850"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-500 dark:text-zinc-400" />
            Catalogue par défaut
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={handleOpenAdd}
            className="text-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            Ajouter un tarif
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-slate-200/90 dark:border-zinc-800/80 bg-white dark:bg-gradient-to-b dark:from-zinc-900/60 dark:to-zinc-950/60 p-4 shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400 mb-2">
            <span>Modèles enregistrés</span>
            <Cpu className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{data?.totalCount ?? 0}</div>
          <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">
            {data?.activeCount ?? 0} actifs pour le calcul et les budgets
          </div>
        </Card>

        <Card className="border-slate-200/90 dark:border-zinc-800/80 bg-white dark:bg-gradient-to-b dark:from-zinc-900/60 dark:to-zinc-950/60 p-4 shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400 mb-2">
            <span>Fournisseurs configurés</span>
            <Filter className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          </div>
          <div className="text-2xl font-bold text-slate-900 dark:text-white">{providers.length}</div>
          <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">
            {providers.join(", ") || "Aucun"}
          </div>
        </Card>

        <Card className="border-slate-200/90 dark:border-zinc-800/80 bg-white dark:bg-gradient-to-b dark:from-zinc-900/60 dark:to-zinc-950/60 p-4 shadow-xs dark:shadow-none">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400 mb-2">
            <span>Option la plus économique</span>
            <TrendingDown className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 truncate">
            {cheapestModel ? cheapestModel.model : "-"}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-zinc-400 mt-1">
            {cheapestModel ? `$${cheapestModel.promptUSDPerMillion}/M tokens prompt` : "Aucun modèle"}
          </div>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par modèle ou fournisseur..."
            className="pl-9 text-xs"
          />
        </div>

        {/* Provider Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          <button
            type="button"
            onClick={() => setSelectedProvider("all")}
            className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors ${
              selectedProvider === "all"
                ? "bg-indigo-600 text-white shadow-xs"
                : "bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 border border-slate-200 dark:border-zinc-800 shadow-xs dark:shadow-none"
            }`}
          >
            Tous
          </button>
          {providers.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setSelectedProvider(p)}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium capitalize transition-colors ${
                selectedProvider === p
                  ? "bg-indigo-600 text-white shadow-xs"
                  : "bg-white dark:bg-zinc-900 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-zinc-200 border border-slate-200 dark:border-zinc-800 shadow-xs dark:shadow-none"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Main Table */}
      <Card className="border-slate-200/90 dark:border-zinc-800/80 bg-white dark:bg-zinc-950/70 overflow-hidden shadow-xs dark:shadow-none">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 dark:border-zinc-800 bg-slate-50/70 dark:bg-zinc-900/40 text-slate-500 dark:text-zinc-400 uppercase tracking-wider text-[10px]">
                <th className="py-3 px-4">Fournisseur</th>
                <th className="py-3 px-4">Modèle</th>
                <th className="py-3 px-4">Prompt ($/1M)</th>
                <th className="py-3 px-4">Completion ($/1M)</th>
                <th className="py-3 px-4">Cache Hit Discount</th>
                <th className="py-3 px-4">Statut</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-zinc-800/50">
              {filteredPricing.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-500 dark:text-zinc-400">
                    Aucun tarif ne correspond à votre recherche.
                  </td>
                </tr>
              ) : (
                filteredPricing.map((item) => (
                  <tr
                    key={`${item.provider}/${item.model}`}
                    className="hover:bg-slate-50/80 dark:hover:bg-zinc-900/30 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <span className="font-semibold text-slate-800 dark:text-zinc-200 capitalize">
                        {item.provider}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="font-mono text-indigo-600 dark:text-indigo-300 font-medium">
                        {item.model}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-800 dark:text-zinc-200">
                      ${item.promptUSDPerMillion.toFixed(4)}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-800 dark:text-zinc-200">
                      ${item.completionUSDPerMillion.toFixed(4)}
                    </td>
                    <td className="py-3 px-4 font-mono">
                      {item.cacheHitUSDPerMillion !== undefined ? (
                        <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                          ${item.cacheHitUSDPerMillion.toFixed(4)}
                        </span>
                      ) : (
                        <span className="text-slate-400 dark:text-zinc-600">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {item.isActive ? (
                        <Badge variant="success" className="text-[10px]">
                          <CheckCircle2 className="w-3 h-3" />
                          Actif
                        </Badge>
                      ) : (
                        <Badge variant="default" className="text-[10px]">
                          <XCircle className="w-3 h-3 text-slate-400 dark:text-zinc-400" />
                          Inactif
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(item)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:text-zinc-400 dark:hover:text-indigo-400 dark:hover:bg-zinc-800/80 transition-colors"
                          title="Modifier le barème"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDelete(item.provider, item.model)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-slate-100 dark:text-zinc-400 dark:hover:text-rose-400 dark:hover:bg-zinc-800/80 transition-colors"
                          title="Supprimer la règle"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Edit/Add Modal */}
      <PricingModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSavePrice}
        initialData={editingItem}
      />
    </div>
  );
};
