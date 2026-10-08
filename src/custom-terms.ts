import type { CustomRedactionTermDef, TermCategory } from "./types";

export interface CustomTermsSanitizationResult {
  text: string;
  maskedCount: number;
  matchedTerms: string[];
}

type NormalizedTermDef = Required<Omit<CustomRedactionTermDef, "id">>;

const DEFAULT_MASKS: Record<TermCategory, string> = {
  PROJECT: "[REDACTED_PROJECT]",
  COMPANY: "[REDACTED_COMPANY]",
  INFRA: "[REDACTED_INFRA]",
  CUSTOM: "[REDACTED_CUSTOM]",
};

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const resolveTermDefinition = (entry: string | CustomRedactionTermDef): NormalizedTermDef => {
  if (typeof entry === "string") {
    return {
      term: entry.trim(),
      mask: DEFAULT_MASKS.CUSTOM,
      category: "CUSTOM",
      caseSensitive: false,
    };
  }

  const category = entry.category ?? "CUSTOM";
  return {
    term: entry.term.trim(),
    mask: entry.mask ?? (DEFAULT_MASKS[category] ?? DEFAULT_MASKS.CUSTOM),
    category,
    caseSensitive: Boolean(entry.caseSensitive),
  };
};

const buildTermRegex = (def: NormalizedTermDef): RegExp => {
  const escaped = escapeRegex(def.term);
  const leadingBoundary = /^\w/.test(def.term) ? "\\b" : "";
  const trailingBoundary = /\w$/.test(def.term) ? "\\b" : "";
  return new RegExp(`${leadingBoundary}${escaped}${trailingBoundary}`, def.caseSensitive ? "g" : "gi");
};

const replaceTermsInText = (
  initialText: string,
  definitions: NormalizedTermDef[]
): { text: string; maskedCount: number; matchedTerms: string[] } => {
  let currentText = initialText;
  let totalMaskedCount = 0;
  const matchedTermsSet = new Set<string>();

  for (const item of definitions) {
    const regex = buildTermRegex(item);
    let matchCount = 0;

    currentText = currentText.replace(regex, () => {
      matchCount++;
      return item.mask;
    });

    if (matchCount > 0) {
      totalMaskedCount += matchCount;
      matchedTermsSet.add(item.term);
    }
  }

  return {
    text: currentText,
    maskedCount: totalMaskedCount,
    matchedTerms: Array.from(matchedTermsSet),
  };
};

export const sanitizeCustomTerms = (
  input: string,
  terms?: Array<string | CustomRedactionTermDef>
): CustomTermsSanitizationResult => {
  if (!input || !terms || terms.length === 0) {
    return { text: input, maskedCount: 0, matchedTerms: [] };
  }

  const normalized = terms
    .map(resolveTermDefinition)
    .filter((t) => t.term.length > 0)
    .sort((a, b) => b.term.length - a.term.length);

  if (normalized.length === 0) {
    return { text: input, maskedCount: 0, matchedTerms: [] };
  }

  return replaceTermsInText(input, normalized);
};
