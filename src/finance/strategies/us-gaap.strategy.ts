import type {
  IAccountingStrategy,
  FinancialJurisdictionCode,
  AccountingStandard,
  FinancialCurrency,
} from "../strategy.interface";

export class UsGAAPStrategy implements IAccountingStrategy {
  readonly jurisdictionCode: FinancialJurisdictionCode = "US";
  readonly standard: AccountingStandard = "US_GAAP";
  readonly defaultCurrency: FinancialCurrency = "USD";

  public cleanNumber(value: string | number): number {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }
    if (!value || typeof value !== "string") {
      return 0;
    }

    let str = value.trim();
    let isNegative = false;

    // Check parentheses or brackets
    const parenMatch = str.match(/^[(\[]\s*(.+?)\s*[)\]]$/);
    if (parenMatch) {
      isNegative = true;
      str = parenMatch[1];
    } else if (str.startsWith("-")) {
      isNegative = true;
      str = str.substring(1).trim();
    }

    // Check magnitude: K, M, B
    let multiplier = 1;
    if (/[kK]\b/.test(str)) {
      multiplier = 1_000;
      str = str.replace(/[kK]\b/g, "").trim();
    } else if (/[mM]\b/.test(str)) {
      multiplier = 1_000_000;
      str = str.replace(/[mM]\b/g, "").trim();
    } else if (/[bB]\b/.test(str)) {
      multiplier = 1_000_000_000;
      str = str.replace(/[bB]\b/g, "").trim();
    }

    // Strip dollar signs, USD and commas
    str = str.replace(/[$]/g, "").replace(/\busd\b/gi, "").replace(/,/g, "").replace(/\s+/g, "").trim();

    const parsed = parseFloat(str);
    if (isNaN(parsed)) {
      return 0;
    }

    const finalVal = parsed * multiplier;
    return isNegative ? -Math.abs(finalVal) : finalVal;
  }

  public cleanJSON(rawText: string): string {
    let result = rawText;

    // 1. Unquoted parentheses or brackets: "net_income": (150,000) or [150,000]
    result = result.replace(
      /(:\s*)[(\[]\s*([0-9][0-9,.]*(?:k|m|b|\$)?)\s*[)\]]/gi,
      (_, prefix, amountStr) => {
        const num = this.cleanNumber(`(${amountStr})`);
        return `${prefix}${num}`;
      }
    );

    // 2. Quoted with parentheses/brackets: "net_income": "(150,000)"
    result = result.replace(
      /(:\s*)"\s*[(\[]\s*([0-9][0-9,.]*(?:k|m|b|\$)?)\s*[)\]]\s*"/gi,
      (_, prefix, amountStr) => {
        const num = this.cleanNumber(`(${amountStr})`);
        return `${prefix}${num}`;
      }
    );

    // 3. Quoted amounts with dollar sign or magnitude: "revenue": "$1,850,000.50"
    result = result.replace(
      /(:\s*)"\s*([+-]?\$?\s*[0-9][0-9,.]*\s*(?:k|m|b|\$)?)\s*"/gi,
      (_, prefix, amountStr) => {
        // Avoid touching non-financial strings
        if (!amountStr.includes("$") && !/[kmb]/i.test(amountStr)) {
          return `${prefix}"${amountStr}"`;
        }
        const num = this.cleanNumber(amountStr);
        return `${prefix}${num}`;
      }
    );

    return result;
  }

  public detect(text: string): boolean {
    const lower = text.toLowerCase();
    const usPatterns = [
      /\b10-[kq]\b/i,
      /\bsec\s+filing\b/i,
      /\bus[\s_-]?gaap\b/i,
      /\bbalance\s+sheet\b/i,
      /\bincome\s+statement\b/i,
      /\bstatement\s+of\s+cash\s+flows\b/i,
      /\$|usd/i,
    ];

    return usPatterns.some((pattern) => pattern.test(lower));
  }
}
