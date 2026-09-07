export interface ModelPrice {
  promptUSDPerMillion: number;
  completionUSDPerMillion: number;
  cacheHitUSDPerMillion?: number;
}

export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  // DeepSeek
  "deepseek-chat": {
    promptUSDPerMillion: 0.14,
    completionUSDPerMillion: 0.28,
    cacheHitUSDPerMillion: 0.014,
  },
  "deepseek-reasoner": {
    promptUSDPerMillion: 0.55,
    completionUSDPerMillion: 2.19,
    cacheHitUSDPerMillion: 0.14,
  },
  // Mistral
  "mistral-small-latest": {
    promptUSDPerMillion: 0.20,
    completionUSDPerMillion: 0.60,
  },
  "mistral-large-latest": {
    promptUSDPerMillion: 2.00,
    completionUSDPerMillion: 6.00,
  },
  // OpenAI
  "gpt-4o-mini": {
    promptUSDPerMillion: 0.15,
    completionUSDPerMillion: 0.60,
  },
  "gpt-4o": {
    promptUSDPerMillion: 2.50,
    completionUSDPerMillion: 10.00,
  },
  // Ollama (local)
  "ollama": {
    promptUSDPerMillion: 0,
    completionUSDPerMillion: 0,
  },
};

export function calculateCostUSD(
  model: string,
  promptTokens: number,
  completionTokens: number,
  cacheHitTokens: number = 0
): number {
  const pricing = DEFAULT_MODEL_PRICES[model] ?? {
    promptUSDPerMillion: 0.5,
    completionUSDPerMillion: 1.5,
  };

  const promptCost = (promptTokens / 1_000_000) * pricing.promptUSDPerMillion;
  const completionCost = (completionTokens / 1_000_000) * pricing.completionUSDPerMillion;
  const cacheDiscount = cacheHitTokens && pricing.cacheHitUSDPerMillion
    ? (cacheHitTokens / 1_000_000) * (pricing.promptUSDPerMillion - pricing.cacheHitUSDPerMillion)
    : 0;

  return Math.max(0, promptCost + completionCost - cacheDiscount);
}
