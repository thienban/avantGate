import { z } from "zod";
import type {
  PromptMessage,
  BuildResult,
  ITokenBudget,
} from "./types";
import { PromptTemplate } from "./prompt-template";

export class PromptBuilder {
  private personaSlot = "";
  private rulesSlot: string[] = [];
  private retryHintSlot = "";
  private fewShotSlot: Array<{ question: string; answer: string }> = [];
  private pinnedFactsSlot = "";
  private contextSlot = "";
  private userPayloadSlot = "";
  private schemaContractText = "";

  constructor(templateOrId?: string | PromptTemplate) {
    if (templateOrId instanceof PromptTemplate) {
      this.personaSlot = templateOrId.template;
    } else if (typeof templateOrId === "string") {
      this.personaSlot = templateOrId.trim();
    }
  }

  public withPersona(persona: string): this {
    this.personaSlot = persona.trim();
    return this;
  }

  public withRules(rules: string | string[]): this {
    if (Array.isArray(rules)) {
      this.rulesSlot.push(...rules.map((rule) => rule.trim()).filter(Boolean));
    } else if (rules) {
      this.rulesSlot.push(rules.trim());
    }
    return this;
  }

  public withRetryHint(hint: string): this {
    this.retryHintSlot = hint.trim();
    return this;
  }

  public withFewShot(examples: Array<{ question: string; answer: string }>): this {
    this.fewShotSlot = examples;
    return this;
  }

  public withPinnedFacts(facts: string | Record<string, unknown>): this {
    if (!facts) return this;
    if (typeof facts === "string") {
      this.pinnedFactsSlot = facts.trim();
      return this;
    }

    this.pinnedFactsSlot = Object.entries(facts)
      .filter(([, val]) => val !== undefined && val !== null && val !== "")
      .map(([key, val]) => `• ${key} : ${Array.isArray(val) ? val.join(", ") : String(val)}`)
      .join("\n");
    return this;
  }

  public withContext(context: string): this {
    this.contextSlot = context.trim();
    return this;
  }

  public withUserPayload(payload: string): this {
    this.userPayloadSlot = payload.trim();
    return this;
  }

  public schemaContract<T>(schema: z.ZodType<T>, options?: { schemaName?: string }): this {
    let shapeDescription = "JSON Object";
    if (schema instanceof z.ZodObject) {
      shapeDescription = JSON.stringify(Object.keys(schema.shape));
    }

    this.schemaContractText = [
      `[DIRECTIVE DE CONTRAT DE SORTIE JSON STRICT]`,
      `Tu DOIS renvoyer UNIQUEMENT un objet JSON valide, sans balises markdown (\`\`\`json), sans texte avant ou après.`,
      `Champs obligatoires et types attendus :`,
      options?.schemaName ? `Schéma : ${options.schemaName}` : "",
      shapeDescription,
    ]
      .filter(Boolean)
      .join("\n");

    return this;
  }

  private assembleMessages(
    pinnedFacts: string,
    context: string,
    userPayload: string
  ): PromptMessage[] {
    const messages: PromptMessage[] = [];

    // Message 0 : Static System (Persona immuable pour KV-Cache Hit)
    let system0 = this.personaSlot || "Tu es un assistant expert.";
    if (this.schemaContractText) {
      system0 += `\n\n${this.schemaContractText}`;
    }
    messages.push({ role: "system", content: system0 });

    // Message 1 (Optionnel) : Dynamic Rules & Retry Hint
    const dynamicParts: string[] = [];
    if (this.rulesSlot.length > 0) {
      dynamicParts.push(
        `[RÈGLES ET CONSIGNES MÉTIER]\n${this.rulesSlot.map((rule, idx) => `${idx + 1}. ${rule}`).join("\n")}`
      );
    }
    if (this.retryHintSlot) {
      dynamicParts.push(`[INSTRUCTION DE CORRECTION / RETRY]\n${this.retryHintSlot}`);
    }
    if (dynamicParts.length > 0) {
      messages.push({ role: "system", content: dynamicParts.join("\n\n") });
    }

    // Message 2 : Few-Shot Examples (si présents)
    if (this.fewShotSlot.length > 0) {
      const examplesContent = this.fewShotSlot
        .map(
          (ex, idx) =>
            `[Exemple ${idx + 1}]\nQuestion: ${ex.question}\nRéponse attendue: ${ex.answer}`
        )
        .join("\n\n");
      messages.push({ role: "system", content: `[EXEMPLES DE RÉFÉRENCE]\n${examplesContent}` });
    }

    // Message 3 : User Payload avec Faits et Contexte
    const userParts: string[] = [];
    if (pinnedFacts) {
      userParts.push(`[FAITS STRUCTURÉS]\n${pinnedFacts}`);
    }
    if (context) {
      userParts.push(`[CONTEXTE DOCUMENTAIRE]\n${context}`);
    }
    if (userPayload) {
      const labelNeeded = Boolean(pinnedFacts || context);
      userParts.push(labelNeeded ? `[DONNÉES À ANALYSER]\n${userPayload}` : userPayload);
    }

    messages.push({ role: "user", content: userParts.join("\n\n") });
    return messages;
  }

  public toMessages(): PromptMessage[] {
    return this.assembleMessages(this.pinnedFactsSlot, this.contextSlot, this.userPayloadSlot);
  }

  public build(budget?: ITokenBudget): BuildResult {
    if (!budget) {
      const messages = this.toMessages();
      const promptText = messages.map((msg) => `${msg.role.toUpperCase()}:\n${msg.content}`).join("\n\n");
      return {
        messages,
        promptText,
        allocatedTokens: Math.ceil(promptText.length / 4),
        isTruncated: false,
      };
    }

    budget.reset();
    let isTruncated = false;
    let truncatedSlot: "context" | "pinnedFacts" | "user" | undefined;

    // Fixed slots reserve tokens first
    let system0 = this.personaSlot || "Tu es un assistant expert.";
    if (this.schemaContractText) {
      system0 += `\n\n${this.schemaContractText}`;
    }
    budget.forceReserve("persona", system0);

    if (this.rulesSlot.length > 0 || this.retryHintSlot) {
      const rulesText = this.rulesSlot.map((rule, idx) => `${idx + 1}. ${rule}`).join("\n");
      budget.forceReserve("rules", `${rulesText}\n${this.retryHintSlot}`);
    }

    let payloadToUse = this.userPayloadSlot;
    let factsToUse = this.pinnedFactsSlot;
    let contextToUse = this.contextSlot;

    // User payload is reserved next
    if (payloadToUse) {
      const payloadCost = budget.count(payloadToUse);
      if (payloadCost > budget.remaining()) {
        const charLimit = Math.max(100, budget.remaining() * 4);
        payloadToUse = payloadToUse.slice(0, charLimit);
        isTruncated = true;
        truncatedSlot = "user";
      }
      budget.reserve("user", payloadToUse);
    }

    // Pinned facts next
    if (factsToUse) {
      const factsCost = budget.count(factsToUse);
      if (factsCost > budget.remaining()) {
        const charLimit = Math.max(50, budget.remaining() * 4);
        factsToUse = factsToUse.slice(0, charLimit);
        isTruncated = true;
        truncatedSlot = "pinnedFacts";
      }
      budget.reserve("pinnedFacts", factsToUse);
    }

    // Context is truncated first if budget is insufficient
    if (contextToUse) {
      const contextCost = budget.count(contextToUse);
      if (contextCost > budget.remaining()) {
        const charLimit = Math.max(0, budget.remaining() * 4);
        contextToUse = contextToUse.slice(0, charLimit);
        isTruncated = true;
        truncatedSlot = "context";
      }
      budget.reserve("context", contextToUse);
    }

    const messages = this.assembleMessages(factsToUse, contextToUse, payloadToUse);
    const promptText = messages.map((msg) => `${msg.role.toUpperCase()}:\n${msg.content}`).join("\n\n");

    return {
      messages,
      promptText,
      allocatedTokens: budget.getAllocated(),
      isTruncated,
      truncatedSlot,
    };
  }
}
