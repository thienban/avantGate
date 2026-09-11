import type {
  IAccountingStrategy,
  FinancialJurisdictionCode,
  AccountingStandard,
  FinancialCurrency,
} from "../strategy.interface";

export class InternationalAccountingStrategy implements IAccountingStrategy {
  readonly jurisdictionCode: FinancialJurisdictionCode = "INTERNATIONAL";
  readonly standard: AccountingStandard = "OTHER";
  readonly defaultCurrency: FinancialCurrency = "EUR";

  public cleanNumber(value: string | number): number {
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }
    if (!value || typeof value !== "string") {
      return 0;
    }

    let str = value.trim();
    let isNegative = false;

    const parenMatch = str.match(/^[(\[]\s*(.+?)\s*[)\]]$/);
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

    // Strip common currency symbols
    str = str.replace(/[€$£]/g, "").replace(/\b(?:eur|usd|gbp|chf)\b/gi, "").trim();

    // If both comma and dot exist, determine separator
    if (str.includes(",") && str.includes(".")) {
      if (str.lastIndexOf(",") > str.lastIndexOf(".")) {
        // e.g. 1.850.000,50
        str = str.replace(/\./g, "").replace(",", ".");
      } else {
        // e.g. 1,850,000.50
        str = str.replace(/,/g, "");
      }
    } else if (str.includes(",")) {
      // If single comma followed by 1 or 2 digits -> decimal
      if (/,\d{1,2}$/.test(str)) {
        str = str.replace(",", ".");
      } else {
        str = str.replace(",", "");
      }
    }

    str = str.replace(/\s+/g, "");
    const parsed = parseFloat(str);
    if (isNaN(parsed)) {
      return 0;
    }

    const finalVal = parsed * multiplier;
    return isNegative ? -Math.abs(finalVal) : finalVal;
  }

  public cleanJSON(rawText: string): string {
    let result = rawText;

    result = result.replace(
      /(:\s*)[(\[]\s*([0-9][0-9,.\s]*(?:k|m|€|\$|£)?)\s*[)\]]/gi,
      (_, prefix, amountStr) => {
        const num = this.cleanNumber(`(${amountStr})`);
        return `${prefix}${num}`;
      }
    );

    result = result.replace(
      /(:\s*)"\s*[(\[]\s*([0-9][0-9,.\s]*(?:k|m|€|\$|£)?)\s*[)\]]\s*"/gi,
      (_, prefix, amountStr) => {
        const num = this.cleanNumber(`(${amountStr})`);
        return `${prefix}${num}`;
      }
    );

    return result;
  }

  public detect(_text: string): boolean {
    return true;
  }
}
