import type { CustomRedactionTermDef } from "./types";

const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,7}\b/g;
const PHONE_FR_REGEX = /\b(?:(?:\+|00)33|0)\s*[1-9](?:[\s.-]*\d{2}){4}\b/g;
const NIR_SSN_REGEX = /\b[12]\s*\d{2}\s*(?:0[1-9]|1[0-2]|[2-9]\d)\s*(?:0[1-9]|[1-8]\d|9[0-8]|2[ABab])\s*(?!000)\d{3}\s*(?!000)\d{3}(?:\s*\d{2})?\b/g;
const SPI_LABELLED_REGEX = /(?:(?:num[ée]ro\s+fiscal|spi|n[°o]\s*fiscal|d[ée]clarant(?: fiscal)?)\s*[:=]?\s*)\b(\d{2}(?:[\s.-]?\d{2}){5}[\s.-]?\d|\d{13})\b/gi;
const SPI_FORMATTED_REGEX = /\b[0-3]\d(?:\s+\d{2}){5}\s+\d\b/g;
const IBAN_REGEX = /\b[A-Z]{2}\s*[0-9]{2}(?:[ .-][A-Z0-9]|\s*\r?\n\s*[A-Z0-9]|[A-Z0-9]){11,30}\b/g;
const BIC_LABELLED_REGEX = /(?:(?:bic|swift)\s*[:=]?\s*)\b([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/gi;

export interface InFlightRedactionOptions {
  salt?: string;
  customTerms?: Array<string | CustomRedactionTermDef>;
  strictValidation?: boolean;
  slidingBufferSize?: number;
}

const convertIbanToNumericString = (rearranged: string): string | null => {
  let result = "";
  for (let i = 0; i < rearranged.length; i++) {
    const charCode = rearranged.charCodeAt(i);
    if (charCode >= 48 && charCode <= 57) {
      result += rearranged[i];
    } else if (charCode >= 65 && charCode <= 90) {
      result += (charCode - 55).toString();
    } else {
      return null;
    }
  }
  return result;
};

export const validateIbanChecksum = (rawIban: string): boolean => {
  const clean = rawIban.replace(/[\s\r\n.-]/g, "").toUpperCase();
  if (clean.length < 15 || clean.length > 34) return false;

  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const numericStr = convertIbanToNumericString(rearranged);
  if (!numericStr) return false;

  try {
    return BigInt(numericStr) % 97n === 1n;
  } catch {
    return false;
  }
};

const normalizeNirBase = (base: string): string => {
  if (base.includes("2A")) return base.replace("2A", "19");
  if (base.includes("2B")) return base.replace("2B", "18");
  return base;
};

export const validateNirChecksum = (rawNir: string): boolean => {
  const clean = rawNir.replace(/[\s.-]/g, "").toUpperCase();
  if (clean.length === 13) {
    return /^[12]\d{2}(?:0[1-9]|1[0-2]|[2-9]\d)(?:0[1-9]|[1-8]\d|9[0-8]|2[AB])(?!000)\d{3}(?!000)\d{3}$/.test(clean);
  }
  if (clean.length !== 15) return false;

  const base = normalizeNirBase(clean.slice(0, 13));
  const key = parseInt(clean.slice(13), 10);
  if (isNaN(key) || key < 1 || key > 97 || !/^\d{13}$/.test(base)) return false;

  const expectedKey = Number(97n - (BigInt(base) % 97n));
  return key === expectedKey;
};

const generateEphemeralSalt = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = new Uint8Array(2);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
};

export class InFlightStreamTransformer {
  private buffer = "";
  private readonly maxBufferSize: number;

  constructor(
    private readonly session: InFlightRedactionSession,
    maxBufferSize = 32
  ) {
    this.maxBufferSize = maxBufferSize;
  }

  transform(chunk: string, controller: TransformStreamDefaultController<string>): void {
    this.buffer += chunk;
    this.flushAvailable(controller);
  }

  flush(controller: TransformStreamDefaultController<string>): void {
    if (this.buffer.length === 0) return;
    controller.enqueue(this.session.restore(this.buffer));
    this.buffer = "";
  }

  private flushAvailable(controller: TransformStreamDefaultController<string>): void {
    if (this.buffer.includes("[DONE]")) {
      this.handleDoneDelimiter(controller);
      return;
    }
    this.processBuffer(controller);
  }

  private handleDoneDelimiter(controller: TransformStreamDefaultController<string>): void {
    const doneIndex = this.buffer.indexOf("[DONE]");
    const beforeDone = this.buffer.slice(0, doneIndex);
    if (beforeDone.length > 0) {
      controller.enqueue(this.session.restore(beforeDone));
    }
    controller.enqueue(this.buffer.slice(doneIndex));
    this.buffer = "";
  }

  private processBuffer(controller: TransformStreamDefaultController<string>): void {
    let current = this.session.restore(this.buffer);

    while (current.length > 0) {
      const lastOpen = current.lastIndexOf("⟪");
      if (lastOpen === -1) {
        controller.enqueue(current);
        this.buffer = "";
        return;
      }

      const closeIndex = current.indexOf("⟫", lastOpen);
      if (closeIndex !== -1) {
        controller.enqueue(current.slice(0, closeIndex + 1));
        current = current.slice(closeIndex + 1);
        continue;
      }

      this.handleUnclosedToken(current, lastOpen, controller);
      return;
    }

    this.buffer = "";
  }

  private handleUnclosedToken(
    current: string,
    lastOpen: number,
    controller: TransformStreamDefaultController<string>
  ): void {
    const suffixLength = current.length - lastOpen;
    if (suffixLength > this.maxBufferSize) {
      const emitLength = current.length - this.maxBufferSize;
      controller.enqueue(current.slice(0, emitLength));
      this.buffer = current.slice(emitLength);
      return;
    }

    if (lastOpen > 0) {
      controller.enqueue(current.slice(0, lastOpen));
    }
    this.buffer = current.slice(lastOpen);
  }
}

const buildCustomTermRegex = (termStr: string, caseSensitive: boolean): RegExp => {
  const escaped = termStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const leadingBoundary = /^\w/.test(termStr) ? "\\b" : "";
  const trailingBoundary = /\w$/.test(termStr) ? "\\b" : "";
  return new RegExp(`${leadingBoundary}${escaped}${trailingBoundary}`, caseSensitive ? "g" : "gi");
};

export class InFlightRedactionSession {
  private readonly saltValue: string;
  private readonly options: InFlightRedactionOptions;
  private readonly tokenToOriginal = new Map<string, string>();
  private readonly originalToToken = new Map<string, string>();
  private readonly typeIndices = new Map<string, number>();
  private disposed = false;

  constructor(options: InFlightRedactionOptions = {}) {
    this.options = options;
    this.saltValue = options.salt ?? generateEphemeralSalt();
  }

  get salt(): string {
    return this.saltValue;
  }

  get size(): number {
    return this.tokenToOriginal.size;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  getMapping(): ReadonlyMap<string, string> {
    return new Map(this.tokenToOriginal);
  }

  getOrCreateToken(type: string, originalValue: string): string {
    const existing = this.originalToToken.get(originalValue);
    if (existing) return existing;

    const nextIndex = (this.typeIndices.get(type) ?? 0) + 1;
    this.typeIndices.set(type, nextIndex);

    const token = `⟪AG:${type}:${nextIndex}:${this.saltValue}⟫`;
    this.tokenToOriginal.set(token, originalValue);
    this.originalToToken.set(originalValue, token);
    return token;
  }

  mask(text: string): string {
    if (!text || this.disposed) return text;

    let processed = text;
    processed = this.maskCustomTerms(processed);
    processed = this.maskEmails(processed);
    processed = this.maskPhones(processed);
    processed = this.maskIbans(processed);
    processed = this.maskBics(processed);
    processed = this.maskNirs(processed);
    processed = this.maskSpis(processed);
    return processed;
  }

  restore(text: string): string {
    if (!text || this.disposed || this.tokenToOriginal.size === 0) {
      return text;
    }

    try {
      const tokenRegex = new RegExp(`⟪AG:[A-Z0-9_]+:\\d+:${this.saltValue}⟫`, "g");
      return text.replace(tokenRegex, (match) => this.tokenToOriginal.get(match) ?? match);
    } catch {
      return text;
    }
  }

  createRestoreTransformStream(): TransformStream<string, string> {
    const bufferSize = this.options.slidingBufferSize ?? 32;
    const transformer = new InFlightStreamTransformer(this, bufferSize);

    return new TransformStream<string, string>({
      transform(chunk, controller) {
        transformer.transform(chunk, controller);
      },
      flush(controller) {
        transformer.flush(controller);
      },
    });
  }

  dispose(): void {
    this.tokenToOriginal.clear();
    this.originalToToken.clear();
    this.typeIndices.clear();
    this.disposed = true;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  private maskCustomTerms(input: string): string {
    const terms = this.options.customTerms;
    if (!terms || terms.length === 0) return input;

    let current = input;
    const sorted = [...terms].sort((a, b) => {
      const lenA = typeof a === "string" ? a.length : a.term.length;
      const lenB = typeof b === "string" ? b.length : b.term.length;
      return lenB - lenA;
    });

    for (const item of sorted) {
      const termStr = typeof item === "string" ? item.trim() : item.term.trim();
      if (!termStr) continue;

      const category = (typeof item === "string" ? "CUSTOM" : (item.category ?? "CUSTOM")).toUpperCase();
      const caseSensitive = typeof item === "string" ? false : Boolean(item.caseSensitive);
      const regex = buildCustomTermRegex(termStr, caseSensitive);

      current = current.replace(regex, (match) => this.getOrCreateToken(category, match));
    }
    return current;
  }

  private maskEmails(input: string): string {
    return input.replace(EMAIL_REGEX, (match) => this.getOrCreateToken("EMAIL", match));
  }

  private maskPhones(input: string): string {
    return input.replace(PHONE_FR_REGEX, (match) => this.getOrCreateToken("PHONE", match));
  }

  private maskIbans(input: string): string {
    const strict = this.options.strictValidation !== false;
    return input.replace(IBAN_REGEX, (match) => {
      const cleanChars = match.replace(/[\s\r\n.-]/g, "");
      const isLengthValid = cleanChars.length >= 15 && cleanChars.length <= 34;
      if (!isLengthValid) return match;

      if (strict && !validateIbanChecksum(cleanChars)) {
        return match;
      }
      return this.getOrCreateToken("IBAN", match);
    });
  }

  private maskBics(input: string): string {
    return input.replace(BIC_LABELLED_REGEX, (fullMatch, bicCode) => {
      const token = this.getOrCreateToken("BIC", bicCode);
      return fullMatch.replace(bicCode, token);
    });
  }

  private maskSpis(input: string): string {
    let result = input.replace(SPI_LABELLED_REGEX, (fullMatch, digits) => {
      const token = this.getOrCreateToken("SPI", digits);
      return fullMatch.replace(digits, token);
    });

    result = result.replace(SPI_FORMATTED_REGEX, (match) => {
      if (match.includes("⟪AG:")) return match;
      return this.getOrCreateToken("SPI", match);
    });
    return result;
  }

  private maskNirs(input: string): string {
    const strict = this.options.strictValidation !== false;
    return input.replace(NIR_SSN_REGEX, (match) => {
      const rawDigits = match.replace(/\s+/g, "");
      const isLenValid = rawDigits.length === 13 || rawDigits.length === 15;
      if (!isLenValid) return match;

      if (strict && !validateNirChecksum(rawDigits)) {
        return match;
      }
      return this.getOrCreateToken("NIR", match);
    });
  }
}

export { InFlightRedactionSession as BidirectionalSanitizer };

export const createInFlightRedactionSession = (
  options?: InFlightRedactionOptions
): InFlightRedactionSession => new InFlightRedactionSession(options);
