import { z } from "zod";
import { cleanFinancialJSON } from "./finance/normalizer";
import type { FinancialJurisdictionCode } from "./finance/strategy.interface";

export interface ValidateOptions {
  normalizer?: (rawText: string) => string;
  financialNormalizer?: boolean;
  jurisdiction?: FinancialJurisdictionCode;
}

/**
 * Nettoie et extrait un bloc JSON valide depuis une réponse de LLM
 * (gère les blocs markdown ```json ... ```, les balises de réflexion, etc.)
 */
export function extractAndCleanJSON(rawText: string): string {
  let cleaned = rawText.trim();

  // Retirer les balises <think>...</think> (DeepSeek R1)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Extraire les blocs markdown ```json ... ``` ou ``` ... ```
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    cleaned = codeBlockMatch[1].trim();
  }

  // Chercher le premier '{' ou '[' et le dernier '}' ou ']'
  const firstBrace = cleaned.indexOf("{");
  const firstBracket = cleaned.indexOf("[");
  let startIndex = -1;

  if (firstBrace !== -1 && firstBracket !== -1) {
    startIndex = Math.min(firstBrace, firstBracket);
  } else if (firstBrace !== -1) {
    startIndex = firstBrace;
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
  }

  const lastBrace = cleaned.lastIndexOf("}");
  const lastBracket = cleaned.lastIndexOf("]");
  const endIndex = Math.max(lastBrace, lastBracket);

  if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
    cleaned = cleaned.slice(startIndex, endIndex + 1);
  }

  return cleaned;
}

/**
 * Valide et auto-répare une sortie JSON contre un schéma Zod.
 * Supporte l'option de normalisation financière (parenthèses négatives, formats comptables).
 */
export function validateWithZod<T>(
  rawText: string,
  schema: z.ZodType<T>,
  options?: ValidateOptions
): T {
  let jsonString = extractAndCleanJSON(rawText);

  if (options?.normalizer) {
    jsonString = options.normalizer(jsonString);
  } else if (options?.financialNormalizer) {
    jsonString = cleanFinancialJSON(jsonString, { jurisdiction: options.jurisdiction });
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonString);
  } catch (_error: unknown) {
    // Tentative de réparation légère (guillemets simples ou virgules traînantes)
    const sanitized = jsonString
      .replace(/,\s*([}\]])/g, "$1") // trailing comma
      .replace(/'/g, '"');
    parsed = JSON.parse(sanitized);
  }

  return schema.parse(parsed);
}
