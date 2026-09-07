/**
 * In-Flight PII Sanitizer for AvantGate.
 * Masque les données sensibles (email, numéros de téléphone, NIR/sécurité sociale, IBAN)
 * avant l'envoi vers des API cloud.
 */

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/g;
const PHONE_FR_REGEX = /\b(?:(?:\+|00)33|0)\s*[1-9](?:[\s.-]*\d{2}){4}\b/g;
const NIR_SSN_REGEX = /\b[12]\s*\d{2}\s*\d{2}\s*\d{2}\s*\d{3}\s*\d{3}(?:\s*\d{2})?\b/g;
const IBAN_REGEX = /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}([A-Z0-9]?){0,16}\b/g;

export interface SanitizeResult {
  text: string;
  maskedCount: number;
}

export function sanitizePII(input: string): SanitizeResult {
  let count = 0;
  let result = input;

  result = result.replace(EMAIL_REGEX, () => {
    count++;
    return "[REDACTED_EMAIL]";
  });

  result = result.replace(PHONE_FR_REGEX, () => {
    count++;
    return "[REDACTED_PHONE]";
  });

  result = result.replace(NIR_SSN_REGEX, () => {
    count++;
    return "[REDACTED_NIR]";
  });

  result = result.replace(IBAN_REGEX, () => {
    count++;
    return "[REDACTED_IBAN]";
  });

  return { text: result, maskedCount: count };
}
