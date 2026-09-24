export interface ModelPricing {
  promptCostPer1M: number;
  completionCostPer1M: number;
}

export const FALLBACK_MODEL_PRICING_TABLE: Record<string, ModelPricing> = {
  "gpt-4o": { promptCostPer1M: 2.5, completionCostPer1M: 10.0 },
  "gpt-4o-mini": { promptCostPer1M: 0.15, completionCostPer1M: 0.6 },
  "gpt-4-turbo": { promptCostPer1M: 10.0, completionCostPer1M: 30.0 },
  "claude-3-5-sonnet-20241022": { promptCostPer1M: 3.0, completionCostPer1M: 15.0 },
  "claude-3-5-haiku": { promptCostPer1M: 0.8, completionCostPer1M: 4.0 },
  "claude-3-opus": { promptCostPer1M: 15.0, completionCostPer1M: 75.0 },
  "gemini-1.5-pro": { promptCostPer1M: 1.25, completionCostPer1M: 5.0 },
  "gemini-1.5-flash": { promptCostPer1M: 0.075, completionCostPer1M: 0.3 },
  "gemini-2.0-flash": { promptCostPer1M: 0.1, completionCostPer1M: 0.4 },
  "deepseek-chat": { promptCostPer1M: 0.14, completionCostPer1M: 0.28 },
  "deepseek-reasoner": { promptCostPer1M: 0.55, completionCostPer1M: 2.19 },
  "ollama": { promptCostPer1M: 0.0, completionCostPer1M: 0.0 },
};

export const MODEL_PRICING_TABLE = FALLBACK_MODEL_PRICING_TABLE;

const DEFAULT_FALLBACK_PRICING: ModelPricing = {
  promptCostPer1M: 0.2,
  completionCostPer1M: 0.8,
};

export const getFallbackModelPricing = (modelName: string): ModelPricing => {
  const normalized = modelName.toLowerCase().trim();
  if (FALLBACK_MODEL_PRICING_TABLE[normalized]) {
    return FALLBACK_MODEL_PRICING_TABLE[normalized];
  }
  const matchingKey = Object.keys(FALLBACK_MODEL_PRICING_TABLE).find((key) =>
    normalized.includes(key)
  );
  return matchingKey ? FALLBACK_MODEL_PRICING_TABLE[matchingKey] : DEFAULT_FALLBACK_PRICING;
};

export const getModelPricing = getFallbackModelPricing;

export const calculateFallbackTokenCost = (
  modelName: string,
  promptTokens: number,
  completionTokens: number
): number => {
  const pricing = getFallbackModelPricing(modelName);
  const promptCost = (promptTokens / 1_000_000) * pricing.promptCostPer1M;
  const completionCost = (completionTokens / 1_000_000) * pricing.completionCostPer1M;
  return Number((promptCost + completionCost).toFixed(7));
};

export const calculateTokenCost = calculateFallbackTokenCost;
