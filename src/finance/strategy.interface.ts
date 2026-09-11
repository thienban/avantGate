export type FinancialJurisdictionCode = "FR" | "US" | "UK" | "CH" | "INTERNATIONAL";
export type AccountingStandard = "PCG" | "US_GAAP" | "IFRS" | "SWISS_CO" | "OTHER";
export type FinancialCurrency = "EUR" | "USD" | "GBP" | "CHF";

export interface IAccountingStrategy {
  readonly jurisdictionCode: FinancialJurisdictionCode;
  readonly standard: AccountingStandard;
  readonly defaultCurrency: FinancialCurrency;

  /** Normalise les formats de nombres et symboles propres au pays */
  cleanNumber(value: string | number): number;

  /** Assainit et répare la syntaxe JSON selon les spécificités du pays */
  cleanJSON(rawText: string): string;

  /** Heuristique de détection automatique à partir du texte brut */
  detect(text: string): boolean;
}
