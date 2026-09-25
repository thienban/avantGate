# 💶 Modular Financial Normalizer (`avantgate/finance`)

AvantGate provides zero-infrastructure, deterministic utilities to sanitize and normalize European/French financial expressions (currencies, decimal formatting, French VAT/TVA) before or after LLM extraction.

---

## ⚡ Supported Transformations

* **Currency Normalization**: Converts `1 250,50 €`, `1,250.50 EUR`, or `$1250` into normalized numeric amounts.
* **French TVA / VAT Validation**: Computes base HT and standard TVA rates (20%, 10%, 5.5%, 2.1%).
* **Number Word Normalization**: Converts textual amounts (*"douze mille euros"*) into numeric format.

---

## 💻 Quickstart Recipe

```typescript
import { normalizeFinancialExpression, calculateVatBreakdown } from "avantgate/finance";

// 1. Normalize messy LLM output:
const parsed = normalizeFinancialExpression("Total TTC: 1 450,80 €");
console.log(parsed.amount); // 1450.80
console.log(parsed.currency); // "EUR"

// 2. Compute French VAT breakdown:
const vat = calculateVatBreakdown(1200, 0.20);
console.log("HT:", vat.amountHT);   // 1000.00
console.log("TVA:", vat.amountVAT); // 200.00
```
