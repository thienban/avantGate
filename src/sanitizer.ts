/**
 * In-Flight PII Sanitizer for AvantGate.
 * Masque les données sensibles (email, téléphone, NIR/sécurité sociale, IBAN/BIC, numéro fiscal SPI)
 * avant l'envoi vers des API cloud.
 */

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/g;
const PHONE_FR_REGEX = /\b(?:(?:\+|00)33|0)\s*[1-9](?:[\s.-]*\d{2}){4}\b/g;

// NIR / Sécurité Sociale français (13 ou 15 chiffres, gère la Corse 2A/2B, commune et ordre non nuls)
const NIR_SSN_REGEX = /\b[12]\s*\d{2}\s*(?:0[1-9]|1[0-2]|[2-9]\d)\s*(?:0[1-9]|[1-8]\d|9[0-8]|2[ABab])\s*(?!000)\d{3}\s*(?!000)\d{3}(?:\s*\d{2})?\b/g;

// Numéro Fiscal Déclarant (SPI) français : 13 chiffres avec contexte fiscal explicite ou espacement structuré
const SPI_LABELLED_REGEX = /(?:(?:num[ée]ro\s+fiscal|spi|n[°o]\s*fiscal|d[ée]clarant(?: fiscal)?)\s*[:=]?\s*)\b(\d{2}(?:[\s.-]?\d{2}){5}[\s.-]?\d|\d{13})\b/gi;
const SPI_FORMATTED_REGEX = /\b[0-3]\d(?:\s+\d{2}){5}\s+\d\b/g;

// IBAN international (gère les espaces et retours chariot au sein de l'IBAN)
const IBAN_REGEX = /\b[A-Z]{2}\s*[0-9]{2}(?:[\s\r\n.-]*[A-Z0-9]){11,30}\b/g;

// Code BIC / SWIFT (8 ou 11 caractères)
const BIC_LABELLED_REGEX = /(?:(?:bic|swift)\s*[:=]?\s*)\b([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/gi;

export interface SanitizeResult {
  text: string;
  maskedCount: number;
}

export const sanitizePII = (input: string): SanitizeResult => {
  let count = 0;
  let result = input;

  // 1. Emails
  result = result.replace(EMAIL_REGEX, () => {
    count++;
    return "[REDACTED_EMAIL]";
  });

  // 2. Téléphones
  result = result.replace(PHONE_FR_REGEX, () => {
    count++;
    return "[REDACTED_PHONE]";
  });

  // 3. IBAN
  result = result.replace(IBAN_REGEX, (match) => {
    // Vérification minimale que ce n'est pas un mot court
    const cleanChars = match.replace(/[\s\r\n.-]/g, "");
    if (cleanChars.length >= 15 && cleanChars.length <= 34) {
      count++;
      return "[REDACTED_IBAN]";
    }
    return match;
  });

  // 4. BIC
  result = result.replace(BIC_LABELLED_REGEX, (_, bicCode) => {
    count++;
    return `[REDACTED_BIC: ${bicCode.slice(0, 4)}****]`;
  });

  // 5. Numéro fiscal SPI
  result = result.replace(SPI_LABELLED_REGEX, (fullMatch, digits) => {
    count++;
    return fullMatch.replace(digits, "[REDACTED_SPI]");
  });

  // 6. NIR / Numéro de Sécurité Sociale (avant pure SPI pour éviter faux positifs)
  result = result.replace(NIR_SSN_REGEX, (match) => {
    const rawDigits = match.replace(/\s+/g, "");
    if (rawDigits.length === 13 || rawDigits.length === 15) {
      count++;
      return "[REDACTED_NIR]";
    }
    return match;
  });

  // 7. SPI formaté par groupes de chiffres (sans mot-clé explicite)
  result = result.replace(SPI_FORMATTED_REGEX, (match) => {
    if (!match.includes("[REDACTED")) {
      count++;
      return "[REDACTED_SPI]";
    }
    return match;
  });

  return { text: result, maskedCount: count };
}
