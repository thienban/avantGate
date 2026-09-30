import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]): string => {
  return twMerge(clsx(inputs));
};

export const formatCurrency = (amount: number): string => {
  if (amount < 0.01 && amount > 0) {
    return `$${amount.toFixed(5)}`;
  }
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(amount);
};

export const formatTokens = (tokens: number): string => {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}k`;
  }
  return tokens.toLocaleString();
};

export const formatDuration = (ms: number): string => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

/**
 * Sanitizes error messages by masking Bearer tokens, API keys, passwords and DB credentials.
 */
export const sanitizeErrorMessage = (message: string): string => {
  if (!message || typeof message !== "string") return message;
  return message
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/Basic\s+[A-Za-z0-9+/=]{8,}/gi, "Basic [REDACTED_AUTH]")
    .replace(/(?:sk|ak|pk)_(?:live|test)_[A-Za-z0-9_-]{16,}/gi, "[REDACTED_API_KEY]")
    .replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:]+):([^@]+)@/g, "$1$2:[REDACTED_PASSWORD]@");
};

export const formatTime = (isoString?: string | null): string => {
  if (!isoString) return "--:--:--";
  if (isoString.length >= 19 && isoString.includes("T")) {
    return isoString.slice(11, 19);
  }
  const date = new Date(isoString);
  return isNaN(date.getTime()) ? "--:--:--" : date.toTimeString().slice(0, 8);
};

export const formatDate = (isoString?: string | null): string => {
  if (!isoString) return "";
  return isoString.slice(0, 10);
};

export const extractBearerToken = (authHeader?: string | null): string | null => {
  if (!authHeader || typeof authHeader !== "string") return null;
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  return token.length > 0 ? token : null;
};

export const pseudoHash = (str: string): string => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(12, "0");
};

export const safeJsonParse = <T>(raw: string | null | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export interface StatusBadgeConfig {
  variant: "default" | "success" | "warning" | "destructive" | "info" | "outline";
  label: string;
  className?: string;
}

export const getStatusBadgeConfig = (status?: string | null): StatusBadgeConfig => {
  switch (status) {
    case "COMPLETED":
      return { variant: "success", label: "Terminé" };
    case "WAITING_APPROVAL":
      return { variant: "warning", label: "Approbation Requise", className: "animate-pulse" };
    case "FAILED":
      return { variant: "destructive", label: "Échec / Disjoncté" };
    case "RETRYING":
      return { variant: "warning", label: "🔄 Rejeu en cours", className: "animate-pulse" };
    case "RECOVERED":
      return { variant: "success", label: "✅ Récupéré", className: "bg-emerald-600 dark:bg-emerald-500" };
    default:
      return { variant: "info", label: "En Cours" };
  }
};


