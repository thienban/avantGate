import type {
  IAccountingStrategy,
  FinancialJurisdictionCode,
  AccountingStandard,
  FinancialCurrency,
} from "../strategy.interface";

export class FrenchPCGStrategy implements IAccountingStrategy {
  readonly jurisdictionCode: FinancialJurisdictionCode = "FR";
  readonly standard: AccountingStandard = "PCG";
  readonly defaultCurrency: FinancialCurrency = "EUR";

  public cleanNumber(value: string | number): number {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }
    if (!value || typeof value !== "string") {
      return 0;
    }

    let str = value.trim();

    // Check for negative parentheses: (150 000) or (150 000 €)
    let isNegative = false;
    const parenMatch = str.match(/^\(\s*(.+?)\s*\)$/);
    if (parenMatch) {
      isNegative = true;
      str = parenMatch[1];
    } else if (str.startsWith("-")) {
      isNegative = true;
      str = str.substring(1).trim();
    }

    // Check multiplier suffix (k€, k, keur, m€, m, meur, etc.)
    let multiplier = 1;
    if (/[kK](?:€|eur)?\b/i.test(str)) {
      multiplier = 1_000;
      str = str.replace(/[kK](?:€|eur)?\b/gi, "").trim();
    } else if (/[mM](?:€|eur)?\b/i.test(str)) {
      multiplier = 1_000_000;
      str = str.replace(/[mM](?:€|eur)?\b/gi, "").trim();
    }

    // Strip currency symbols and spaces
    str = str.replace(/[€$£]/g, "").replace(/\s+/g, "").replace(/\u00A0/g, "").trim();

    // Replace French decimal comma with period
    str = str.replace(",", ".");

    const parsed = parseFloat(str);
    if (isNaN(parsed)) {
      return 0;
    }

    const finalValue = parsed * multiplier;
    return isNegative ? -Math.abs(finalValue) : finalValue;
  }

  public cleanJSON(rawText: string): string {
    let result = rawText;

    // 1. Convert unquoted negative parentheses after property colon:
    // e.g. "resultat_net": (150 000) -> "resultat_net": -150000
    // or "resultat_net": ( 150 000,50 € ) -> "resultat_net": -150000.50
    result = result.replace(
      /(:\s*)\(\s*([0-9][0-9\s.,]*(?:k€|k|keur|m€|m|meur|€)?)\s*\)/gi,
      (_, prefix, amountStr) => {
        const num = this.cleanNumber(`(${amountStr})`);
        return `${prefix}${num}`;
      }
    );

    // 2. Convert quoted numeric values with parentheses or French formats:
    // e.g. "resultat": "(150 000 €)" -> "resultat": -150000
    // or "ca": "1 850 k€" -> "ca": 1850000
    // or "montant": "1 850 000,50 €" -> "montant": 1850000.50
    result = result.replace(
      /(:\s*)"\s*\(\s*([0-9][0-9\s.,]*(?:k€|k|keur|m€|m|meur|€)?)\s*\)\s*"/gi,
      (_, prefix, amountStr) => {
        const num = this.cleanNumber(`(${amountStr})`);
        return `${prefix}${num}`;
      }
    );

    // 3. Convert quoted amounts with currency or magnitude:
    // Only convert if string is pure number format with optional magnitude/currency
    result = result.replace(
      /(:\s*)"\s*([+-]?[0-9][0-9\s.,]*(?:k€|k|keur|m€|m|meur|€))\s*"/gi,
      (_, prefix, amountStr) => {
        const num = this.cleanNumber(amountStr);
        return `${prefix}${num}`;
      }
    );

    // 4. Convert quoted numbers with spaces and/or decimal comma without currency:
    // e.g. "1 850 000,50" -> 1850000.5, "1 850 000" -> 1850000, "12,50" -> 12.5
    // Excludes plain contiguous digits (e.g. "75001" or "123456789") to avoid corrupting postal codes or SIRENs
    result = result.replace(
      /(:\s*)"\s*([+-]?(?:[0-9]{1,3}(?:\s+[0-9]{3})+(?:,[0-9]+)?|[0-9]+,[0-9]+))\s*"/g,
      (_, prefix, amountStr) => {
        const num = this.cleanNumber(amountStr);
        return `${prefix}${num}`;
      }
    );

    return result;
  }

  public detect(text: string): boolean {
    const lower = text.toLowerCase();
    const frPatterns = [
      /\bcerfa\b/i,
      /\bliasse\s+fiscale\b/i,
      /\bbilan\s+(actif|passif)\b/i,
      /\bcompte\s+de\s+r[ée]sultat\b/i,
      /\bplan\s+comptable\s+g[ée]n[ée]ral\b/i,
      /\bpcg\b/i,
      /\bsiren\b/i,
      /\bsiret\b/i,
      /\b[0-9\s.,]+(?:k€|m€)\b/i,
      /\beur\b/i,
      /€/,
    ];

    return frPatterns.some((pattern) => pattern.test(lower));
  }
}
