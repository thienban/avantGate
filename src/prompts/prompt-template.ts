import { z } from "zod";
import type {
  PromptTemplateOptions,
  PromptValidationResult,
  PromptLabel,
} from "./types";

const DEFAULT_JAILBREAK_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior)\s+(instructions|rules)/i,
  /disregard\s+(all\s+)?(previous|prior)\s+(instructions|rules)/i,
  /system\s+override/i,
  /you\s+are\s+now\s+(unrestricted|DAN|jailbroken)/i,
  /<\s*\|\s*im_start\s*\|>/i,
  /\[SYSTEM_PROMPT\]/i,
];

export class PromptTemplate<
  TVariables extends Record<string, unknown> = Record<string, unknown>
> {
  readonly id: string;
  readonly version: number;
  readonly label: PromptLabel;
  readonly description?: string;
  readonly template: string;
  readonly inputSchema?: z.ZodType<TVariables>;
  private blockPatterns: RegExp[];
  private antiInjectionEnabled: boolean;
  private customSanitizer?: (value: string) => string;

  constructor(options: PromptTemplateOptions<TVariables>) {
    this.id = options.id;
    this.version = options.version;
    this.label = options.label || "production";
    this.description = options.description;
    this.template = options.template;
    this.inputSchema = options.inputSchema;
    this.antiInjectionEnabled = options.antiInjection?.enabled !== false;
    this.blockPatterns = options.antiInjection?.blockPatterns || DEFAULT_JAILBREAK_PATTERNS;
    this.customSanitizer = options.antiInjection?.sanitizer;
  }

  public validateUserInput(variables: TVariables): PromptValidationResult {
    const threats: string[] = [];

    if (this.inputSchema) {
      const parsed = this.inputSchema.safeParse(variables);
      if (!parsed.success) {
        return {
          isValid: false,
          threats: parsed.error.issues.map(
            (issue) => `${issue.path.join(".")}: ${issue.message}`
          ),
        };
      }
    }

    if (this.antiInjectionEnabled) {
      for (const [key, val] of Object.entries(variables)) {
        if (typeof val === "string") {
          for (const pattern of this.blockPatterns) {
            if (pattern.test(val)) {
              threats.push(
                `Potential prompt injection in variable "${key}" matching pattern ${pattern}`
              );
            }
          }
        }
      }
    }

    return { isValid: threats.length === 0, threats };
  }

  public format(variables: TVariables): string {
    const check = this.validateUserInput(variables);
    if (!check.isValid) {
      throw new Error(
        `[PromptTemplate:${this.id}] Validation failed: ${check.threats.join(", ")}`
      );
    }

    const interpolated = this.template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
      let value = variables[key];
      if (value === undefined || value === null) {
        return "";
      }
      let stringValue =
        typeof value === "object" ? JSON.stringify(value) : String(value);
      if (this.customSanitizer) {
        stringValue = this.customSanitizer(stringValue);
      }
      return stringValue;
    });

    return interpolated
      .split("\n")
      .filter((line, index, arr) => line.trim() !== "" || (index > 0 && arr[index - 1].trim() !== ""))
      .join("\n");
  }
}
