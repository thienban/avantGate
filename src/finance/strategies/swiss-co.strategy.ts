import type {
  IAccountingStrategy,
  FinancialJurisdictionCode,
  AccountingStandard,
  FinancialCurrency,
} from "../strategy.interface";

export class SwissCOStrategy implements IAccountingStrategy {
  readonly jurisdictionCode: FinancialJurisdictionCode = "CH";
  readonly standard: AccountingStandard = "SWISS_CO";
  readonly defaultCurrency: FinancialCurrency = "CHF";

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

    // Strip CHF and Swiss apostrophe separator (' or ’)
    str = str.replace(/\bchf\b/gi, "").replace(/['’]/g, "").replace(/\s+/g, "").trim();
    // In Swiss accounting, period is commonly used for decimals, but comma might also appear
    str = str.replace(",", ".");

    const parsed = parseFloat(str);
    if (isNaN(parsed)) {
      return 0;
    }

    const finalVal = parsed * multiplier;
    return isNegative ? -Math.abs(finalVal) : finalVal;
  }

  public cleanJSON(rawText: string): string {
    let result = rawText;

    // Unquoted parentheses: "perte": (150'000)
    result = result.replace(
      /(:\s*)\(\s*([0-9][0-9'’.,\s]*(?:k|m|chf)?)\s*\)/gi,
      (_, prefix, amountStr) => {
        const num = this.cleanNumber(`(${amountStr})`);
        return `${prefix}${num}`;
      }
    );

    // Quoted parentheses: "perte": "(150'000 CHF)"
    result = result.replace(
      /(:\s*)"\s*\(\s*([0-9][0-9'’.,\s]*(?:k|m|chf)?)\s*\)\s*"/gi,
      (_, prefix, amountStr) => {
        const num = this.cleanNumber(`(${amountStr})`);
        return `${prefix}${num}`;
      }
    );

    // Quoted Swiss formatted amounts: "capital": "1'850'000 CHF"
    result = result.replace(
      /(:\s*)"\s*([+-]?[0-9][0-9'’.,\s]*(?:k|m|chf))\s*"/gi,
      (_, prefix, amountStr) => {
        const num = this.cleanNumber(amountStr);
        return `${prefix}${num}`;
      }
    );

    return result;
  }

  public detect(text: string): boolean {
    const lower = text.toLowerCase();
    const chPatterns = [
      /\bcode\s+des\s+obligations\b/i,
      /\bart\.?\s*725\b/i,
      /\bche-[0-9]{3}\.[0-9]{3}\.[0-9]{3}\b/i,
      /\bchf\b/i,
      /\b[0-9]{1,3}(?:'[0-9]{3})+\b/,
    ];

    return chPatterns.some((pattern) => pattern.test(lower));
  }
}
