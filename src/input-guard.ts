/**
 * Active Input & Security Guard for AvantGate.
 * Bloque les tentatives de jailbreak, fuite de prompt système et attaques d'injection.
 */

const INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior)\s+(?:instructions|prompts|rules)/i,
  /disregard\s+(?:all\s+)?(?:previous|prior)\s+(?:instructions|prompts)/i,
  /you\s+are\s+now\s+(?:dan|unrestricted|in\s+developer\s+mode)/i,
  /bypass\s+(?:all\s+)?(?:content\s+filters|safety\s+guidelines)/i,
  /output\s+(?:your\s+)?(?:system\s+prompt|initial\s+instructions)/i,
  /repeat\s+(?:the\s+words\s+above|everything\s+above)/i,
];

export interface InputGuardResult {
  valid: boolean;
  blockedReason?: string;
}

export const validateUserInput = (
  input: string,
  options?: { detectInjection?: boolean; maxLength?: number }
): InputGuardResult => {
  const maxLength = options?.maxLength ?? 50_000;
  if (input.length > maxLength) {
    return {
      valid: false,
      blockedReason: `Input length (${input.length}) exceeds max allowed (${maxLength})`,
    };
  }

  if (options?.detectInjection !== false) {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        return {
          valid: false,
          blockedReason: `Prompt injection or jailbreak detected: matches security rule [${pattern.source}]`,
        };
      }
    }
  }

  return { valid: true };
}
