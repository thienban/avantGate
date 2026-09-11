import { PromptTemplate } from "./prompt-template";
import type { PromptTemplateOptions, PromptLabel } from "./types";

export class PromptRegistry {
  private static registry: Map<string, PromptTemplate<any>[]> = new Map();

  public static register<T extends Record<string, unknown>>(
    templateOrOptions: PromptTemplate<T> | PromptTemplateOptions<T>
  ): void {
    const template =
      templateOrOptions instanceof PromptTemplate
        ? templateOrOptions
        : new PromptTemplate(templateOrOptions);

    const existing = this.registry.get(template.id) || [];
    // Remove if same version already registered
    const filtered = existing.filter((item) => item.version !== template.version);
    filtered.push(template);
    // Sort versions descending
    filtered.sort((a, b) => b.version - a.version);
    this.registry.set(template.id, filtered);
  }

  public static get<T extends Record<string, unknown> = Record<string, unknown>>(
    id: string,
    options?: { version?: number; label?: PromptLabel }
  ): PromptTemplate<T> {
    const templates = this.registry.get(id);
    if (!templates || templates.length === 0) {
      throw new Error(`[PromptRegistry] No prompt template registered with id: "${id}"`);
    }

    if (options?.version !== undefined) {
      const match = templates.find((item) => item.version === options.version);
      if (!match) {
        throw new Error(
          `[PromptRegistry] Template "${id}" with version ${options.version} not found`
        );
      }
      return match as PromptTemplate<T>;
    }

    if (options?.label) {
      const match = templates.find((item) => item.label === options.label);
      if (match) {
        return match as PromptTemplate<T>;
      }
    }

    // Default to highest version
    return templates[0] as PromptTemplate<T>;
  }

  public static has(id: string): boolean {
    return this.registry.has(id);
  }

  public static clear(): void {
    this.registry.clear();
  }
}
