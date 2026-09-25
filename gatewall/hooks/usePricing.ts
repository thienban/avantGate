"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ModelPricingItem, PricingListResponse } from "@/lib/types/pricing";

export const PRICING_QUERY_KEYS = {
  PRICING: ["pricing"] as const,
};

export const usePricingQuery = () => {
  return useQuery<PricingListResponse>({
    queryKey: PRICING_QUERY_KEYS.PRICING,
    queryFn: async () => {
      const res = await fetch("/api/v1/pricing");
      if (!res.ok) {
        throw new Error("Erreur lors de la récupération des tarifs de modèles");
      }
      return res.json();
    },
  });
};

export const useUpsertPriceMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Omit<ModelPricingItem, "updatedAt">) => {
      const res = await fetch("/api/v1/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Impossible d'enregistrer le tarif");
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRICING_QUERY_KEYS.PRICING });
    },
  });
};

export const useDeletePriceMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ provider, model }: { provider: string; model: string }) => {
      const params = new URLSearchParams({ provider, model });
      const res = await fetch(`/api/v1/pricing?${params.toString()}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error("Impossible de supprimer la règle tarifaire");
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRICING_QUERY_KEYS.PRICING });
    },
  });
};

export const useSeedPricingMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (force: boolean = false) => {
      const res = await fetch("/api/v1/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seed", force }),
      });

      if (!res.ok) {
        throw new Error("Échec de la réinitialisation des tarifs par défaut");
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRICING_QUERY_KEYS.PRICING });
    },
  });
};
