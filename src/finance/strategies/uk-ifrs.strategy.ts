import type {
  IAccountingStrategy,
  FinancialJurisdictionCode,
  AccountingStandard,
  FinancialCurrency,
} from "../strategy.interface";

export class UkIFRSStrategy implements IAccountingStrategy {
  readonly jurisdictionCode: FinancialJurisdictionCode = "UK";
  readonly standard: AccountingStandard = "IFRS";
  readonly defaultCurrency: FinancialCurrency = "GBP";

  public cleanNumber(value: string | number): number {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }
    if (!value || typeof value !== "string") {
      return 0;
    }

    let str = value.trim();
    let isNegative = false;

    const parenMatch = str.match(/^\(\s*(.+?)\s*\)$/);
    if (parenMatch) {
      isNegative = true;
      str = parenMatch[1];
    } else if (str.startsWith("-")) {
      isNegative = true;
      str = str.substring(1).trim();
    }

    let multiplier = 1;
    if (/[kK]\b/.test(str)) {
      multiplier = 1_000;
      str = str.replace(/[kK]\b/g, "").trim();
    } else if (/[mM]\b/.test(str)) {
      multiplier = 1_000_000;
      str = str.replace(/[mM]\b/g, "").trim();
    }

    str = str.replace(/[£]/g, "").replace(/\bgbp\b/gi, "").replace(/,/g, "").replace(/\s+/g, "").trim();

    const parsed = parseFloat(str);
    if (isNaN(parsed)) {
      return 0;
    }

    const finalVal = parsed * multiplier;
    return isNegative ? -Math.abs(finalVal) : finalVal;
  }

  public cleanJSON(rawText: string): string {
    let result = rawText;

    // Unquoted parentheses: "profit_loss": (150,000)
    result = result.replace(
      /(:\s*)\(\s*([0-9][0-9,.]*(?:k|m|£)?)\s*\)/gi,
      (_, prefix, amountStr) => {
        const num = this.cleanNumber(`(${amountStr})`);
        return `${prefix}${num}`;
      }
    );

    // Quoted parentheses: "profit_loss": "(150,000 £)"
    result = result.replace(
      /(:\s*)"\s*\(\s*([0-9][0-9,.]*(?:k|m|£)?)\s*\)\s*"/gi,
      (_, prefix, amountStr) => {
        const num = this.cleanNumber(`(${amountStr})`);
        return `${prefix}${num}`;
      }
    );

    // Quoted pound amounts
    result = result.replace(
      /(:\s*)"\s*([+-]?£\s*[0-9][0-9,.]*\s*(?:k|m)?)\s*"/gi,
      (_, prefix, amountStr) => {
        const num = this.cleanNumber(amountStr);
        return `${prefix}${num}`;
      }
    );

    return result;
  }

  public detect(text: string): boolean {
    const lower = text.toLowerCase();
    const ukPatterns = [
      /\bcompanies\s+house\b/i,
      /\bfrs\s*102\b/i,
      /\bhmrc\b/i,
      /\bprofit\s+and\s+loss\b/i,
      /£|\bgbp\b/i,
    ];

    return ukPatterns.some((pattern) => pattern.test(lower));
  }
}
