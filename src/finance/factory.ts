import type {
  IAccountingStrategy,
  FinancialJurisdictionCode,
} from "./strategy.interface";
import { FrenchPCGStrategy } from "./strategies/french-pcg.strategy";
import { UsGAAPStrategy } from "./strategies/us-gaap.strategy";
import { UkIFRSStrategy } from "./strategies/uk-ifrs.strategy";
import { SwissCOStrategy } from "./strategies/swiss-co.strategy";
import { InternationalAccountingStrategy } from "./strategies/international.strategy";

export class AccountingFactory {
  private static strategies: Map<FinancialJurisdictionCode, IAccountingStrategy> = new Map();
  private static detectionOrder: IAccountingStrategy[] = [];

  static {
    this.initDefaults();
  }

  private static initDefaults(): void {
    const fr = new FrenchPCGStrategy();
    const us = new UsGAAPStrategy();
    const uk = new UkIFRSStrategy();
    const ch = new SwissCOStrategy();
    const intl = new InternationalAccountingStrategy();

    this.registerStrategy(ch);
    this.registerStrategy(uk);
    this.registerStrategy(us);
    this.registerStrategy(fr);
    this.registerStrategy(intl);
  }

  public static registerStrategy(strategy: IAccountingStrategy): void {
    this.strategies.set(strategy.jurisdictionCode, strategy);
    // Remove if already in detection order and unshift to prioritize newer registrations
    this.detectionOrder = [
      strategy,
      ...this.detectionOrder.filter((s) => s.jurisdictionCode !== strategy.jurisdictionCode),
    ];
  }

  public static getStrategy(code?: FinancialJurisdictionCode): IAccountingStrategy {
    if (!code) {
      return this.strategies.get("FR") || new FrenchPCGStrategy();
    }
    const strategy = this.strategies.get(code);
    if (!strategy) {
      return this.strategies.get("FR") || new FrenchPCGStrategy();
    }
    return strategy;
  }

  public static detectStrategy(documentText: string): IAccountingStrategy {
    for (const strategy of this.detectionOrder) {
      if (strategy.jurisdictionCode !== "INTERNATIONAL" && strategy.detect(documentText)) {
        return strategy;
      }
    }
    return this.getStrategy("FR");
  }

  public static resetDefaults(): void {
    this.strategies.clear();
    this.detectionOrder = [];
    this.initDefaults();
  }
}
