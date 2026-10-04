import { cleanFinancialJSON, calculateVatBreakdown } from "avantgate/finance";

export const runFinancialNormalizerExample = (): void => {
  // Normalizes French/European accounting formats, parentheses as negatives, k€/M€ multipliers
  const rawAccountingInput = '{ "loss": (150 000), "cash": "1 850 k€", "ebitda": "2.4 M€" }';
  const cleaned = cleanFinancialJSON(rawAccountingInput, { jurisdiction: "FR" });
  console.log("Normalized Financial Metrics:", cleaned);
  // Output: { loss: -150000, cash: 1850000, ebitda: 2400000 }

  // Computes precise VAT and base HT amounts
  const vat = calculateVatBreakdown(1200, 0.20);
  console.log(`Base HT: €${vat.amountHT}, VAT: €${vat.amountVAT} (Rate: ${vat.rate * 100}%)`);
};
