import { z } from "zod";

export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type PromptLabel = "production" | "staging" | "experimental";

export interface PromptTemplateOptions<TVariables extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  version: number;
  label?: PromptLabel;
  description?: string;
  template: string;
  inputSchema?: z.ZodType<TVariables>;
  antiInjection?: {
    enabled?: boolean;
    blockPatterns?: RegExp[];
    sanitizer?: (value: string) => string;
  };
}

export interface PromptValidationResult {
  isValid: boolean;
  threats: string[];
}

export interface ITokenBudget {
  count(text: string): number;
  remaining(): number;
  reserve(slot: string, text: string): void;
  forceReserve(slot: string, text: string): void;
  getAllocated(): number;
  reset(): void;
}

export interface BuildResult {
  messages: PromptMessage[];
  promptText: string;
  allocatedTokens?: number;
  isTruncated: boolean;
  truncatedSlot?: "context" | "pinnedFacts" | "user";
}
