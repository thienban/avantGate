import { SqlitePricingAdapter } from "avantgate";

export const runPricingAdapterExample = async (): Promise<void> => {
  const adapter = new SqlitePricingAdapter({
    filename: "./gatewall/data/gatewall.db",
  });

  await adapter.seedDefaultPrices(false);

  const price = await adapter.getPrice("openai", "gpt-4o");
  console.log("GPT-4o Input Price per 1M tokens ($):", price?.promptUSDPerMillion);
  console.log("GPT-4o Output Price per 1M tokens ($):", price?.completionUSDPerMillion);
};
