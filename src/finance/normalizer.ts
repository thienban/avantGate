import type { FinancialJurisdictionCode } from "./strategy.interface";
import { AccountingFactory } from "./factory";
import { extractAndCleanJSON } from "../response-validator";

export interface FinancialNormalizerOptions {
  jurisdiction?: FinancialJurisdictionCode;
  autoDetect?: boolean;
}

/**
 * Assainit et répare une chaîne JSON contenant des données financières :
 * - Notation comptable négative entre parenthèses : (150 000) -> -150000
 * - Espaces et virgules décimales : "1 850 000,50 €" -> 1850000.50
 * - Abréviations de grandeurs : "1 850 k€" -> 1850000, "2.4 M€" -> 2400000
 * - Suppression des symboles de devises dans les positions numériques
 * - Préservation stricte des chaînes descriptives normales contenant des parenthèses
 */
export const cleanFinancialJSON = (
  rawText: string,
  options?: FinancialNormalizerOptions
): string => {
  if (!rawText) {
    return "";
  }

  // 1. Extraire le bloc JSON brut
  const jsonBlock = extractAndCleanJSON(rawText);

  // 2. Résoudre la stratégie comptable
  const strategy = options?.jurisdiction
    ? AccountingFactory.getStrategy(options.jurisdiction)
    : options?.autoDetect !== false
      ? AccountingFactory.detectStrategy(rawText)
      : AccountingFactory.getStrategy("FR");

  // 3. Appliquer le nettoyage de la stratégie
  return strategy.cleanJSON(jsonBlock);
};

/**
 * Crée une fonction de transformation financière réutilisable.
 */
export const withFinancialNormalizer = (
  options?: FinancialNormalizerOptions
): ((rawText: string) => string) => {
  return (rawText: string) => cleanFinancialJSON(rawText, options);
};
