export class MiddlewareTimeoutError extends Error {
  public readonly middlewareName: string;
  public readonly timeoutMs: number;
  public readonly phase: "beforeRequest" | "afterResponse";

  constructor(middlewareName: string, phase: "beforeRequest" | "afterResponse", timeoutMs: number) {
    super(`Middleware "${middlewareName}" execution timed out during ${phase} after ${timeoutMs}ms.`);
    this.name = "MiddlewareTimeoutError";
    this.middlewareName = middlewareName;
    this.phase = phase;
    this.timeoutMs = timeoutMs;
  }
}

export class InvalidMessageSchemaError extends Error {
  public readonly middlewareName: string;
  public readonly validationErrors: unknown;

  constructor(middlewareName: string, validationErrors: unknown) {
    super(`Middleware "${middlewareName}" returned an invalid messages payload failing ChatMessageSchema validation.`);
    this.name = "InvalidMessageSchemaError";
    this.middlewareName = middlewareName;
    this.validationErrors = validationErrors;
  }
}

export class PromptInjectionError extends Error {
  public readonly reason: string;

  constructor(reason: string) {
    super(`[AvantGate Security Guard] Request blocked: ${reason}`);
    this.name = "PromptInjectionError";
    this.reason = reason;
  }
}
