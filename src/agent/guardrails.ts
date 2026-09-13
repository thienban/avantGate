import { sanitizePII } from "../sanitizer";
import { PiiLeakError } from "./errors";

export interface AuditToolResultOutput {
  sanitizedData: unknown;
  maskedCount: number;
}

export interface AuditToolResultOptions {
  toolName: string;
  throwOnPii?: boolean;
}

function sanitizeString(value: string): { text: string; count: number } {
  const result = sanitizePII(value);
  return { text: result.text, count: result.maskedCount };
}

function sanitizeArray(
  items: unknown[],
  options: AuditToolResultOptions
): { sanitized: unknown[]; count: number } {
  let totalCount = 0;
  const sanitized = items.map((item) => {
    const res = recursivelySanitize(item, options);
    totalCount += res.count;
    return res.sanitized;
  });
  return { sanitized, count: totalCount };
}

function sanitizeObject(
  target: Record<string, unknown>,
  options: AuditToolResultOptions
): { sanitized: Record<string, unknown>; count: number } {
  let totalCount = 0;
  const copy: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(target)) {
    const res = recursivelySanitize(val, options);
    copy[key] = res.sanitized;
    totalCount += res.count;
  }
  return { sanitized: copy, count: totalCount };
}

function recursivelySanitize(
  data: unknown,
  options: AuditToolResultOptions
): { sanitized: unknown; count: number } {
  if (typeof data === "string") {
    const res = sanitizeString(data);
    return { sanitized: res.text, count: res.count };
  }

  if (Array.isArray(data)) {
    const res = sanitizeArray(data, options);
    return { sanitized: res.sanitized, count: res.count };
  }

  if (data !== null && typeof data === "object") {
    const res = sanitizeObject(data as Record<string, unknown>, options);
    return { sanitized: res.sanitized, count: res.count };
  }

  return { sanitized: data, count: 0 };
}

/**
 * Audits and sanitizes data returned by tools before sending it to the LLM.
 * Throws PiiLeakError if throwOnPii is enabled and PII is detected.
 */
export function auditToolResult(
  data: unknown,
  options: AuditToolResultOptions
): AuditToolResultOutput {
  const { sanitized, count } = recursivelySanitize(data, options);

  if (options.throwOnPii && count > 0) {
    throw new PiiLeakError(options.toolName, count);
  }

  return {
    sanitizedData: sanitized,
    maskedCount: count,
  };
}
