import { SecretLeakBlockedError } from "./types";
import { sanitizePII } from "./sanitizer";

export interface SecretPatternDef {
  type: string;
  regex: RegExp;
  mask: string;
}

const SECRET_PATTERNS: SecretPatternDef[] = [
  // 1. Clés privées (RSA, OpenSSH, EC, DSA)
  {
    type: "PRIVATE_KEY",
    regex: /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/g,
    mask: "[REDACTED_PRIVATE_KEY]",
  },
  // 2. Clés Anthropic Claude (avant OpenAI pour éviter collision sk-)
  {
    type: "ANTHROPIC_API_KEY",
    regex: /\bsk-ant-(?:api\d{2}-)?[A-Za-z0-9_-]{20,}\b/g,
    mask: "[REDACTED_ANTHROPIC_KEY]",
  },
  // 3. Clés OpenAI (standard, projet, admin) - exclut explicitement sk-ant-
  {
    type: "OPENAI_API_KEY",
    regex: /\bsk-(?!ant-)(?:proj-|admin-|org-)?[A-Za-z0-9_-]{20,}\b/g,
    mask: "[REDACTED_OPENAI_KEY]",
  },
  // 4. Clés AWS Access Key ID
  {
    type: "AWS_ACCESS_KEY",
    regex: /\b(?:AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b/g,
    mask: "[REDACTED_AWS_KEY]",
  },
  // 5. Tokens GitHub (Personal, OAuth, User, Server)
  {
    type: "GITHUB_TOKEN",
    regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,255}\b/g,
    mask: "[REDACTED_GITHUB_TOKEN]",
  },
  // 6. JSON Web Tokens (JWT)
  {
    type: "JWT_TOKEN",
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g,
    mask: "[REDACTED_JWT]",
  },
  // 7. Tokens Slack
  {
    type: "SLACK_TOKEN",
    regex: /\bxox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,}\b/g,
    mask: "[REDACTED_SLACK_TOKEN]",
  },
  // 8. Mots de passe dans URL de connexion (Postgres, Mongo, Redis, MySQL)
  {
    type: "DATABASE_CONNECTION_SECRET",
    regex: /(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:\s\/@]+:([^@\s]+)@/gi,
    mask: "[REDACTED_DB_SECRET]",
  },
];

export interface SecretDetection {
  type: string;
  matchedCount: number;
}

export interface SanitizeSecretsResult {
  text: string;
  hasSecrets: boolean;
  detections: SecretDetection[];
}

export const sanitizeSecrets = (input: string): SanitizeSecretsResult => {
  let text = input;
  const detections: SecretDetection[] = [];

  for (const pattern of SECRET_PATTERNS) {
    let matchCount = 0;
    if (pattern.type === "DATABASE_CONNECTION_SECRET") {
      text = text.replace(pattern.regex, (fullMatch, password) => {
        matchCount++;
        return fullMatch.replace(password, pattern.mask);
      });
    } else {
      text = text.replace(pattern.regex, () => {
        matchCount++;
        return pattern.mask;
      });
    }

    if (matchCount > 0) {
      detections.push({ type: pattern.type, matchedCount: matchCount });
    }
  }

  return {
    text,
    hasSecrets: detections.length > 0,
    detections,
  };
};

export interface OutputGuardOptions {
  maskPII?: boolean;
  blockSecretLeaks?: boolean;
  secretLeakAction?: "REDACT" | "BLOCK";
}

export interface OutputGuardResult {
  text: string;
  sanitized: boolean;
  secretDetected: boolean;
  piiMaskedCount: number;
  detections: SecretDetection[];
}

export const applyOutputGuards = (
  rawOutput: string,
  options?: OutputGuardOptions
): OutputGuardResult => {
  let currentText = rawOutput;
  let piiCount = 0;

  // 1. Masquage PII en sortie si activé
  if (options?.maskPII) {
    const piiResult = sanitizePII(currentText);
    currentText = piiResult.text;
    piiCount = piiResult.maskedCount;
  }

  // 2. Détection et neutralisation des secrets
  const secretResult = sanitizeSecrets(currentText);
  currentText = secretResult.text;

  // 3. Si action = BLOCK et présence de secrets, lever l'exception
  if (secretResult.hasSecrets && options?.secretLeakAction === "BLOCK") {
    const types = secretResult.detections.map((d) => d.type).join(", ");
    throw new SecretLeakBlockedError(
      `[AvantGate Output Guard] Response blocked: detected potential secret leak (${types})`,
      secretResult.detections
    );
  }

  return {
    text: currentText,
    sanitized: piiCount > 0 || secretResult.hasSecrets,
    secretDetected: secretResult.hasSecrets,
    piiMaskedCount: piiCount,
    detections: secretResult.detections,
  };
};
