export interface ModelPricingItem {
  provider: string;
  model: string;
  promptUSDPerMillion: number;
  completionUSDPerMillion: number;
  cacheHitUSDPerMillion?: number;
  isActive: boolean;
  updatedAt: string;
}

export interface PricingListResponse {
  pricing: ModelPricingItem[];
  totalCount: number;
  activeCount: number;
}
