import type { ModelPrice, PricingAdapter } from "./types";
export type { ModelPrice, PricingAdapter };
export * from "./sqlite-pricing-adapter";

export interface CalculateCostOptions {
  provider?: string;
  providerPricing?: ModelPrice;
  customPricing?: Record<string, ModelPrice>;
  adapter?: PricingAdapter;
}

/**
 * Catalogue indicatif non injecté par défaut dans le moteur.
 * Les utilisateurs peuvent s'en servir comme jeu de données initial (ex: seed Prisma)
 * ou pour peupler le PricingRegistry s'ils souhaitent des valeurs de départ.
 */
export const SEED_MODEL_PRICES: Record<string, ModelPrice> = {
  // DeepSeek Direct
  "deepseek-chat": { promptUSDPerMillion: 0.14, completionUSDPerMillion: 0.28, cacheHitUSDPerMillion: 0.014 },
  "deepseek-reasoner": { promptUSDPerMillion: 0.55, completionUSDPerMillion: 2.19, cacheHitUSDPerMillion: 0.14 },
  "deepseek/deepseek-chat": { promptUSDPerMillion: 0.14, completionUSDPerMillion: 0.28, cacheHitUSDPerMillion: 0.014 },
  "deepseek/deepseek-reasoner": { promptUSDPerMillion: 0.55, completionUSDPerMillion: 2.19, cacheHitUSDPerMillion: 0.14 },

  // Mistral AI Direct
  "mistral-small-latest": { promptUSDPerMillion: 0.20, completionUSDPerMillion: 0.60 },
  "mistral-large-latest": { promptUSDPerMillion: 2.00, completionUSDPerMillion: 6.00 },
  "mistral/mistral-small-latest": { promptUSDPerMillion: 0.20, completionUSDPerMillion: 0.60 },
  "mistral/mistral-large-latest": { promptUSDPerMillion: 2.00, completionUSDPerMillion: 6.00 },

  // OpenAI Direct
  "gpt-4o-mini": { promptUSDPerMillion: 0.15, completionUSDPerMillion: 0.60 },
  "gpt-4o": { promptUSDPerMillion: 2.50, completionUSDPerMillion: 10.00 },
  "openai/gpt-4o-mini": { promptUSDPerMillion: 0.15, completionUSDPerMillion: 0.60 },
  "openai/gpt-4o": { promptUSDPerMillion: 2.50, completionUSDPerMillion: 10.00 },

  // OpenRouter Direct
  "openrouter/deepseek/deepseek-chat": { promptUSDPerMillion: 0.14, completionUSDPerMillion: 0.28 },
  "openrouter/deepseek/deepseek-r1": { promptUSDPerMillion: 0.55, completionUSDPerMillion: 2.19 },
  "openrouter/anthropic/claude-3.5-sonnet": { promptUSDPerMillion: 3.00, completionUSDPerMillion: 15.00 },

  // Local Ollama (Toujours $0)
  "ollama": { promptUSDPerMillion: 0, completionUSDPerMillion: 0 },
};

const normalizeKey = (identifier: string): string => {
  return identifier.trim().toLowerCase().replace(":", "/");
};

export class CachedPricingAdapter implements PricingAdapter {
  private cache = new Map<string, { price: ModelPrice; expiresAt: number }>();
  private ttlMs: number;
  private delegate: PricingAdapter;

  constructor(delegate: PricingAdapter, ttlMs: number = 5 * 60 * 1000) {
    this.delegate = delegate;
    this.ttlMs = ttlMs;
  }

  fetchPrice = async (model: string, provider?: string): Promise<ModelPrice | undefined> => {
    const key = provider ? normalizeKey(`${provider}/${model}`) : normalizeKey(model);
    const cached = this.cache.get(key);

    if (cached && Date.now() < cached.expiresAt) {
      return cached.price;
    }

    try {
      const freshPrice = await this.delegate.fetchPrice(model, provider);
      if (freshPrice) {
        this.cache.set(key, { price: freshPrice, expiresAt: Date.now() + this.ttlMs });
        return freshPrice;
      }
    } catch {
      // Tolérance aux pannes : conserver le dernier prix en cache si existant
      if (cached) {
        return cached.price;
      }
    }

    return undefined;
  };

  peek = (model: string, provider?: string): ModelPrice | undefined => {
    const key = provider ? normalizeKey(`${provider}/${model}`) : normalizeKey(model);
    const cached = this.cache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.price;
    }
    return undefined;
  };

  clearCache = (): void => {
    this.cache.clear();
  };

  invalidate = (model?: string, provider?: string): void => {
    if (!model) {
      this.clearCache();
      return;
    }
    const key = provider ? normalizeKey(`${provider}/${model}`) : normalizeKey(model);
    this.cache.delete(key);
  };
}

/**
 * Registre de tarification dynamique.
 * Démarre 100% vide : aucune valeur codée en dur n'est imposée par défaut (Option A : Strict & Truthful).
 */
export class PricingRegistry {
  private static prices = new Map<string, ModelPrice>();
  private static adapter?: PricingAdapter;

  static registerPrice = (identifier: string, price: ModelPrice): void => {
    PricingRegistry.prices.set(normalizeKey(identifier), price);
  };

  static registerDistributorPrices = (distributor: string, priceMap: Record<string, ModelPrice>): void => {
    for (const [model, price] of Object.entries(priceMap)) {
      PricingRegistry.prices.set(normalizeKey(`${distributor}/${model}`), price);
    }
  };

  static registerPrices = (prices: Record<string, ModelPrice>): void => {
    for (const [key, price] of Object.entries(prices)) {
      PricingRegistry.prices.set(normalizeKey(key), price);
    }
  };

  static getPrice = (model: string, provider?: string): ModelPrice | undefined => {
    if (provider) {
      const distributorKey = normalizeKey(`${provider}/${model}`);
      const directDistributorPrice = PricingRegistry.prices.get(distributorKey);
      if (directDistributorPrice) {
        return directDistributorPrice;
      }
    }
    return PricingRegistry.prices.get(normalizeKey(model));
  };

  static setAdapter = (adapter: PricingAdapter): void => {
    PricingRegistry.adapter = adapter;
  };

  static getAdapter = (): PricingAdapter | undefined => {
    return PricingRegistry.adapter;
  };

  static clear = (): void => {
    PricingRegistry.prices.clear();
    PricingRegistry.adapter = undefined;
  };

  /**
   * Réinitialise le registre en chargeant le catalogue d'exemple SEED_MODEL_PRICES.
   */
  static loadSeedPrices = (): void => {
    PricingRegistry.registerPrices(SEED_MODEL_PRICES);
  };

  static getAllPrices = (): Record<string, ModelPrice> => {
    const out: Record<string, ModelPrice> = {};
    for (const [k, v] of PricingRegistry.prices.entries()) {
      out[k] = v;
    }
    return out;
  };
}

// Proxy de rétrocompatibilité pour `DEFAULT_MODEL_PRICES[model]`
export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = new Proxy({} as Record<string, ModelPrice>, {
  get(_target, prop: string) {
    return PricingRegistry.getPrice(prop);
  },
  has(_target, prop: string) {
    return Boolean(PricingRegistry.getPrice(prop));
  },
  ownKeys() {
    return Object.keys(PricingRegistry.getAllPrices());
  },
  getOwnPropertyDescriptor(_target, prop: string) {
    const price = PricingRegistry.getPrice(prop);
    if (price) {
      return { value: price, enumerable: true, configurable: true, writable: false };
    }
    return undefined;
  },
});

export const resolveModelPrice = (
  model: string,
  options?: CalculateCostOptions | string
): ModelPrice | undefined => {
  const opts: CalculateCostOptions = typeof options === "string" ? { provider: options } : (options ?? {});

  // 1. Surcharge explicite dans ProviderConfig
  if (opts.providerPricing) {
    return opts.providerPricing;
  }

  // 2. Surcharge customPricing de l'instance
  if (opts.customPricing) {
    if (opts.provider) {
      const customDistributorKey = normalizeKey(`${opts.provider}/${model}`);
      if (opts.customPricing[customDistributorKey]) {
        return opts.customPricing[customDistributorKey];
      }
    }
    if (opts.customPricing[normalizeKey(model)] ?? opts.customPricing[model]) {
      return opts.customPricing[normalizeKey(model)] ?? opts.customPricing[model];
    }
  }

  // 3. Cache de l'adaptateur dynamique (si disponible de manière synchrone)
  const activeAdapter = opts.adapter ?? PricingRegistry.getAdapter();
  if (activeAdapter instanceof CachedPricingAdapter) {
    const cached = activeAdapter.peek(model, opts.provider);
    if (cached) {
      return cached;
    }
  }

  // 4. Registre global (avec repli distributeur/modele -> modele)
  const registeredPrice = PricingRegistry.getPrice(model, opts.provider);
  if (registeredPrice) {
    return registeredPrice;
  }

  // 5. Cas spécial local Ollama ($0)
  if (opts.provider === "ollama" || model.toLowerCase().includes("ollama")) {
    return { promptUSDPerMillion: 0, completionUSDPerMillion: 0 };
  }

  // Strict & Truthful : aucun prix arbitraire inventé
  return undefined;
};

export const resolveModelPriceAsync = async (
  model: string,
  options?: CalculateCostOptions | string
): Promise<ModelPrice | undefined> => {
  const opts: CalculateCostOptions = typeof options === "string" ? { provider: options } : (options ?? {});

  // Si un adaptateur est configuré, interroger en amont
  const activeAdapter = opts.adapter ?? PricingRegistry.getAdapter();
  if (activeAdapter) {
    try {
      const adapterPrice = await activeAdapter.fetchPrice(model, opts.provider);
      if (adapterPrice) {
        return adapterPrice;
      }
    } catch {
      // repli en cascade
    }
  }

  return resolveModelPrice(model, options);
};

export const calculateCostUSD = (
  model: string,
  promptTokens: number,
  completionTokens: number,
  cacheHitTokens: number = 0,
  options?: CalculateCostOptions | string
): number => {
  const pricing = resolveModelPrice(model, options);

  if (!pricing) {
    return 0;
  }

  const promptCost = (promptTokens / 1_000_000) * pricing.promptUSDPerMillion;
  const completionCost = (completionTokens / 1_000_000) * pricing.completionUSDPerMillion;
  const cacheDiscount = cacheHitTokens && pricing.cacheHitUSDPerMillion
    ? (cacheHitTokens / 1_000_000) * (pricing.promptUSDPerMillion - pricing.cacheHitUSDPerMillion)
    : 0;

  return Math.max(0, promptCost + completionCost - cacheDiscount);
};
