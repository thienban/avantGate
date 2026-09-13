# FEAT-184: Évolution AvantGate v1.1.0 (Prompt Builder/Templates, Normalisation Financière Modulaire & Guardrails Fiscaux)

- **Statut**: DONE <!-- Options: TODO | IN_PROGRESS | IN_REVIEW | DONE -->
- **Priorité**: MEDIUM <!-- Options: LOW | MEDIUM | HIGH | CRITICAL -->
- **Type**: Feature <!-- Options: Feature | Bug | Refactor | Docs | Chore -->
- **Projet Externe Lié**: [avantGate GitHub](https://github.com/thienban/avantGate) • [NPM Package `avantgate`](https://www.npmjs.com/package/avantgate)
- **Tickets LexTalk Liés**: [FEAT-177](file:///c:/Users/Bui/Desktop/DevProjets/lextalk/.tickets/FEAT-177-integration-bibliotheque-avantgate-npm.md) (Intégration v1.0.0), [FEAT-180](file:///c:/Users/Bui/Desktop/DevProjets/lextalk/.tickets/FEAT-180-pipeline-extraction-financiere-prompt-personnalise-json.md) (Pipeline Extraction Financière)
- **Date de création**: 2026-09-10
- **Assigné à**: Antigravity

---

## 🎯 Objectif & Contexte

Faire évoluer la bibliothèque open-source autonome [**`avantgate`**](https://github.com/thienban/avantGate) de la version **v1.0.0** vers la version **v1.1.0**.

Bien que le pipeline d'extraction financière de LexTalk ([FEAT-180](file:///c:/Users/Bui/Desktop/DevProjets/lextalk/.tickets/FEAT-180-pipeline-extraction-financiere-prompt-personnalise-json.md)) soit déjà fonctionnel et validé, l'objectif de cette évolution est d'enrichir le moteur in-process d'AvantGate pour en faire un socle de référence pour les cas d'usage complexes (extraction financière, liasses fiscales Cerfa 2050, comptabilité d'entreprise et conformité RGPD renforcée).

---

## 📋 Critères d'Acceptation & Spécifications v1.1.0

### 0. Architecture Modulaire & Activation par Option (Opt-in Zero-Overhead)
- [x] **Architecture Découplée (Tree-Shakable)** :
  - La gestion financière ne doit pas alourdir le bundle core d'AvantGate pour les utilisateurs généraux (zero impact sur le temps d'exécution et la taille pour ceux qui n'utilisent que `sanitizePII` ou `InputGuard`).
  - **Subpath Export dédié dans `package.json`** :
    ```json
    "exports": {
      ".": { "types": "./dist/index.d.ts", "import": "./dist/index.mjs" },
      "./finance": { "types": "./dist/finance/index.d.ts", "import": "./dist/finance/index.mjs" }
    }
    ```
  - **Import autonome direct** :
    ```ts
    import { cleanFinancialJSON, withFinancialNormalizer } from "avantgate/finance";
    ```
- [x] **Option d'activation dans `AvantGateControlLayer`** :
  - Possibilité d'activer la normalisation financière via un flag optionnel dans la configuration du control plane :
    ```ts
    const gate = new AvantGateControlLayer({
      primary: { provider: "mistral", model: "mistral-large-latest" },
      features: {
        finance: {
          enableFrenchAccounting: true, // normalisation des parenthèses négatives et k€
          stripCurrencySymbols: true,   // suppression des symboles €, $, etc.
        },
      },
    });
    ```

### 1. Pattern Strategy & Factory Multi-Pays / Normes Comptables (`avantgate/finance`)
- [x] **Interface `IAccountingStrategy` (Strategy Pattern)** :
  ```ts
  export interface IAccountingStrategy {
    readonly jurisdictionCode: "FR" | "US" | "UK" | "CH" | "INTERNATIONAL";
    readonly standard: "PCG" | "US_GAAP" | "IFRS" | "SWISS_CO" | "OTHER";
    readonly defaultCurrency: "EUR" | "USD" | "GBP" | "CHF";

    /** Normalise les formats de nombres et symboles propres au pays */
    cleanNumber(value: string | number): number;

    /** Assainit et répare la syntaxe JSON selon les spécificités du pays */
    cleanJSON(rawText: string): string;

    /** Heuristique de détection automatique à partir du texte brut */
    detect(text: string): boolean;
  }
  ```
- [x] **Stratégies par Défaut Implémentées** :
  - `FrenchPCGStrategy` : Plan Comptable Général français (gestion des Cerfa 2033/2050, k€, virgules décimales, parenthèses comptables négatives).
  - `UsGAAPStrategy` : Form 10-K, 10-Q, virgules comme séparateurs de milliers, points décimaux, brackets pour négatifs.
  - `UkIFRSStrategy` : FRS 102, Companies House, format GBP.
  - `SwissCOStrategy` : Code des obligations suisse (art. 725 CO, numéros CHE-).
- [x] **`AccountingFactory` (Factory Pattern & Registre Extensible)** :
  ```ts
  export class AccountingFactory {
    static getStrategy(code?: FinancialJurisdictionCode): IAccountingStrategy;
    static detectStrategy(documentText: string): IAccountingStrategy;
    static registerStrategy(strategy: IAccountingStrategy): void;
  }
  ```
- [x] **Utilisation Simple & Fluide** :
  ```ts
  import { AccountingFactory } from "avantgate/finance";

  // Détection automatique ou résolution par code pays
  const strategy = AccountingFactory.detectStrategy(rawText);
  const cleanedJson = strategy.cleanJSON(rawText);
  ```

### 2. Normalisation Arithmétique & Auto-Réparation Financière (`avantgate/finance`)
- [x] **Utilitaire `cleanFinancialJSON(rawText: string, options?: { jurisdiction?: string }): string`** :
  - Conversion automatique des notations comptables négatives entre parenthèses : `(150 000)` ➔ `-150000`.
  - Normalisation des formats numériques avec espaces et virgules : `"1 850 000,50 €"` ou `"1 850 000,50"` ➔ `1850000.50`.
  - Résolution des abréviations de grandeurs courantes : `"1 850 k€"` ➔ `1850000`, `"2.4 M€"` ➔ `2400000`.
  - Tolérance aux symboles monétaires (`€`, `$`, `£`, `CHF`) insérés par les LLMs dans des champs numériques.
- [x] Wrapper optionnel `validateWithZod(rawText, schema, { financialNormalizer: true, jurisdiction: "FR" })` activable à la demande.

### 3. Méthode Unifiée `generateStructuredOutput` dans `AvantGateControlLayer`
- [x] Ajouter une méthode de premier niveau simplifiant l'extraction typée sans code boilerplate :
  ```ts
  const result = await gate.generateStructuredOutput<FinancialData>({
    model: "mistral-large-latest",
    messages: promptMessages,
    schema: financialSchema,
    maxRetries: 2,
  });
  ```
- [x] Gestion automatique du failover multi-fournisseurs (Mistral ➔ DeepSeek ➔ OpenAI) et comptabilisation précise des tokens consommés.

### 4. Moteur de Prompting In-Process : `PromptRegistry`, `PromptTemplate` & `PromptBuilder`
*(Objectif LexTalk : Remplacer `src/lib/ai/prompts/registry.ts`, `src/lib/ai/prompt-builder.ts` et `finance-analyzer/prompt-builder.ts` par les primitives officielles d'AvantGate)*

#### 4.1 Spécifications & Signatures TypeScript

##### A. Classe `PromptTemplate<TVariables>`
```ts
import { z } from "zod";

export interface PromptTemplateOptions<TVariables extends Record<string, unknown>> {
  id: string;
  version: number;
  label?: "production" | "staging" | "experimental";
  description?: string;
  template: string; // Supporte la syntaxe Mustache {{variable}}
  inputSchema?: z.ZodType<TVariables>;
  antiInjection?: {
    enabled: boolean;
    blockPatterns?: RegExp[]; // Patterns de jailbreak / prompt injection
    sanitizer?: (value: string) => string;
  };
}

export interface PromptValidationResult {
  isValid: boolean;
  threats: string[];
}

export class PromptTemplate<TVariables extends Record<string, unknown> = Record<string, unknown>> {
  readonly id: string;
  readonly version: number;
  readonly label: "production" | "staging" | "experimental";
  readonly template: string;
  readonly inputSchema?: z.ZodType<TVariables>;

  constructor(options: PromptTemplateOptions<TVariables>);

  /** Valide les variables contre le schéma Zod et analyse les risques d'injection */
  validateUserInput(variables: TVariables): PromptValidationResult;

  /** Interpole les variables {{cle}} et nettoie les sauts de ligne orphelins */
  format(variables: TVariables): string;
}
```

##### B. Classe `PromptBuilder` (Fluent Builder & Caching Optimisé)
```ts
import { z } from "zod";

export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BuildResult {
  messages: PromptMessage[];
  promptText: string;
  allocatedTokens?: number;
  isTruncated: boolean;
  truncatedSlot?: "context" | "pinnedFacts" | "user";
}

export interface ITokenBudget {
  count(text: string): number;
  remaining(): number;
  reserve(slot: string, text: string): void;
  forceReserve(slot: string, text: string): void;
  getAllocated(): number;
  reset(): void;
}

export class PromptBuilder {
  /** Initialise à partir d'un template ou vierge */
  constructor(templateOrId?: string | PromptTemplate);

  /** Slot 0 : Persona immuable (KV-Cache Hit au token 0) */
  withPersona(persona: string): this;

  /** Slot 1 : Consignes dynamiques / Règles de droit ou de comptabilité */
  withRules(rules: string | string[]): this;

  /** Slot 1 bis : Instructions de correction en cas de retry */
  withRetryHint(hint: string): this;

  /** Slot 2 : Exemples Few-Shot d'excellence */
  withFewShot(examples: Array<{ question: string; answer: string }>): this;

  /** Slot 3 : Faits structurés / Pinned Facts (Métadonnées société, SIREN, dates) */
  withPinnedFacts(facts: string | Record<string, unknown>): this;

  /** Slot 4 : Contexte documentaire RAG (tronqué en priorité si dépassement de budget) */
  withContext(context: string): this;

  /** Slot 5 : Payload utilisateur final / Question ou document à analyser */
  withUserPayload(payload: string): this;

  /** Injecte automatiquement la contrainte de formatage JSON strict à partir d'un schéma Zod */
  schemaContract<T>(schema: z.ZodType<T>, options?: { schemaName?: string }): this;

  /** Compilation vers le format standard des modèles d'inférence */
  toMessages(): PromptMessage[];

  /** Compilation avec contrôle strict de budget de tokens et troncature déterministe */
  build(budget?: ITokenBudget): BuildResult;
}
```

##### C. Classe `PromptRegistry`
```ts
export class PromptRegistry {
  static register<T extends Record<string, unknown>>(template: PromptTemplate<T> | PromptTemplateOptions<T>): void;
  static get<T extends Record<string, unknown> = Record<string, unknown>>(
    id: string,
    options?: { version?: number; label?: "production" | "staging" | "experimental" }
  ): PromptTemplate<T>;
  static has(id: string): boolean;
  static clear(): void;
}
```

---

#### 4.2 Exemple d'Implémentation Core pour `avantGate`

##### Exemple : `src/prompts/prompt-template.ts`
```ts
import { z } from "zod";

const DEFAULT_JAILBREAK_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior)\s+instructions/i,
  /system\s+override/i,
  /you\s+are\s+now\s+(unrestricted|DAN|jailbroken)/i,
  /<\s*\|\s*im_start\s*\|>/i,
  /\[SYSTEM_PROMPT\]/i,
];

export class PromptTemplate<TVariables extends Record<string, unknown> = Record<string, unknown>> {
  readonly id: string;
  readonly version: number;
  readonly label: "production" | "staging" | "experimental";
  readonly template: string;
  readonly inputSchema?: z.ZodType<TVariables>;
  private blockPatterns: RegExp[];

  constructor(options: PromptTemplateOptions<TVariables>) {
    this.id = options.id;
    this.version = options.version;
    this.label = options.label || "production";
    this.template = options.template;
    this.inputSchema = options.inputSchema;
    this.blockPatterns = options.antiInjection?.blockPatterns || DEFAULT_JAILBREAK_PATTERNS;
  }

  public validateUserInput(variables: TVariables): PromptValidationResult {
    const threats: string[] = [];

    // 1. Validation de schéma Zod
    if (this.inputSchema) {
      const parsed = this.inputSchema.safeParse(variables);
      if (!parsed.success) {
        return { isValid: false, threats: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
      }
    }

    // 2. Détection d'injection dans les chaînes de caractères
    for (const [key, val] of Object.entries(variables)) {
      if (typeof val === "string") {
        for (const pattern of this.blockPatterns) {
          if (pattern.test(val)) {
            threats.push(`Potential prompt injection in variable "${key}" matching pattern ${pattern}`);
          }
        }
      }
    }

    return { isValid: threats.length === 0, threats };
  }

  public format(variables: TVariables): string {
    const check = this.validateUserInput(variables);
    if (!check.isValid) {
      throw new Error(`[PromptTemplate:${this.id}] Validation failed: ${check.threats.join(", ")}`);
    }

    const interpolated = this.template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
      const value = variables[key];
      if (value === undefined || value === null) return "";
      return String(value);
    });

    // Nettoyage des lignes vides orphelines
    return interpolated
      .split("\n")
      .filter((line, i, arr) => line.trim() !== "" || (i > 0 && arr[i - 1].trim() !== ""))
      .join("\n");
  }
}
```

##### Exemple : `src/prompts/prompt-builder.ts` (`schemaContract` & Assemblage par Slots)
```ts
import { z } from "zod";

export class PromptBuilder {
  private personaSlot = "";
  private rulesSlot: string[] = [];
  private retryHintSlot = "";
  private fewShotSlot: Array<{ question: string; answer: string }> = [];
  private pinnedFactsSlot = "";
  private contextSlot = "";
  private userPayloadSlot = "";
  private schemaContractText = "";

  public withPersona(persona: string): this {
    this.personaSlot = persona.trim();
    return this;
  }

  public withRules(rules: string | string[]): this {
    if (Array.isArray(rules)) {
      this.rulesSlot.push(...rules.map((r) => r.trim()));
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
    } else {
      this.pinnedFactsSlot = Object.entries(facts)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `• ${k} : ${Array.isArray(v) ? v.join(", ") : String(v)}`)
        .join("\n");
    }
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
    // Génère la directive impérative pour garantir un JSON valide
    this.schemaContractText = [
      `[DIRECTIVE DE CONTRAT DE SORTIE JSON STRICT]`,
      `Tu DOIS renvoyer UNIQUEMENT un objet JSON valide, sans balises markdown (\`\`\`json), sans texte avant ou après.`,
      `Champs obligatoires et types attendus :`,
      options?.schemaName ? `Schéma : ${options.schemaName}` : "",
      JSON.stringify(schema instanceof z.ZodObject ? Object.keys(schema.shape) : "JSON Object"),
    ].filter(Boolean).join("\n");
    return this;
  }

  public toMessages(): PromptMessage[] {
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
      dynamicParts.push(`[RÈGLES ET CONSIGNES MÉTIER]\n${this.rulesSlot.map((r, i) => `${i + 1}. ${r}`).join("\n")}`);
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
        .map((e, idx) => `[Exemple ${idx + 1}]\nQuestion: ${e.question}\nRéponse attendue: ${e.answer}`)
        .join("\n\n");
      messages.push({ role: "system", content: `[EXEMPLES DE RÉFÉRENCE]\n${examplesContent}` });
    }

    // Message N : User Payload avec Faits et Contexte
    const userParts: string[] = [];
    if (this.pinnedFactsSlot) {
      userParts.push(`[FAITS STRUCTURÉS]\n${this.pinnedFactsSlot}`);
    }
    if (this.contextSlot) {
      userParts.push(`[CONTEXTE DOCUMENTAIRE]\n${this.contextSlot}`);
    }
    if (this.userPayloadSlot) {
      userParts.push(this.pinnedFactsSlot || this.contextSlot ? `[DONNÉES À ANALYSER]\n${this.userPayloadSlot}` : this.userPayloadSlot);
    }

    messages.push({ role: "user", content: userParts.join("\n\n") });
    return messages;
  }
}
```

---

#### 4.3 Exemples Concrets d'Intégration dans LexTalk

##### Exemple 1 : Remplacement dans `src/lib/services/finance-analyzer/finance-analyzer.service.ts`
```ts
import { PromptBuilder } from "avantgate";
import { cleanFinancialJSON } from "avantgate/finance";
import { corporateFinanceSchema, personalFinanceSchema, type CorporateFinanceData } from "./finance-schemas";

export async function buildFinancialAnalysisPrompt(
  filename: string,
  rawDocumentText: string,
  profileType: "COMPANY" | "INDIVIDUAL"
) {
  const isCompany = profileType === "COMPANY";

  const builder = new PromptBuilder()
    .withPersona(
      isCompany
        ? "Tu es un expert-comptable et auditeur financier chevronné spécialisé dans l'analyse des liasses fiscales françaises."
        : "Tu es un conseiller patrimonial et financier expert en analyse de solvabilité."
    )
    .withRules([
      "Normalise tous les montants en euros numériques sans symboles de devises.",
      "Convertis les montants entre parenthèses comme des valeurs négatives.",
      "Si une ligne n'est pas présente, utilise null ou 0 selon le schéma.",
    ])
    .schemaContract(isCompany ? corporateFinanceSchema : personalFinanceSchema, {
      schemaName: isCompany ? "CorporateFinanceData" : "PersonalFinanceData",
    })
    .withPinnedFacts({
      Fichier: filename,
      Profil: profileType,
      DeviseCible: "EUR",
    })
    .withUserPayload(rawDocumentText.slice(0, 16000));

  return builder.toMessages();
}

// Utilisation directe avec assainissement financier AvantGate :
export function parseAndValidateFinancialResult(rawLLMOutput: string): CorporateFinanceData {
  // Assainissement des (150 000) ➔ -150000 et des k€ avant validation Zod
  const cleanedJSON = cleanFinancialJSON(rawLLMOutput, { jurisdiction: "FR" });
  return corporateFinanceSchema.parse(JSON.parse(cleanedJSON));
}
```

##### Exemple 2 : Définition d'un Template Versionné avec `PromptRegistry`
```ts
import { PromptRegistry, PromptTemplate } from "avantgate";
import { z } from "zod";

// 1. Enregistrement d'un template sécurisé avec validation Zod des inputs
PromptRegistry.register(
  new PromptTemplate({
    id: "audit-juridique-clause",
    version: 2,
    label: "production",
    description: "Analyse des clauses de non-concurrence et pénalités contractuelles",
    inputSchema: z.object({
      clauseType: z.string().min(2),
      contractText: z.string().min(10),
      jurisdiction: z.enum(["FR", "BE", "CH"]).default("FR"),
    }),
    template: `Tu es un juriste spécialisé en droit des contrats (Juridiction : {{jurisdiction}}).
Analyse la clause suivante de type "{{clauseType}}" :
{{contractText}}
Identifie les risques de nullité et propose une rédaction protectrice.`,
  })
);

// 2. Utilisation dans un Use-Case / Service
const template = PromptRegistry.get("audit-juridique-clause");
const userPrompt = template.format({
  clauseType: "Non-concurrence",
  contractText: "Le salarié s'interdit d'exercer toute activité concurrente pendant 5 ans sans indemnité.",
  jurisdiction: "FR",
});
```

### 5. Masquage PII Étendu pour Liasses Fiscales & Formulaires Administratifs
- [x] Enrichir `sanitizePII(text: string)` pour détecter et masquer :
  - **NIR / Numéro de Sécurité Sociale français** : 13 ou 15 chiffres (présent sur les déclarations de gérance et Cerfa).
  - **Numéro Fiscal Déclarant (SPI)** : 13 chiffres.
  - **Numéros bancaires BIC/IBAN** (amélioration de la tolérance aux espaces et retours chariot).

### 6. Outillage, Tests & Publication NPM
- [x] Écrire la suite de tests unitaires dédiée dans le dépôt AvantGate (`tests/financial-normalizer.test.ts`, `tests/prompt-builder.test.ts`, `tests/pii-extended.test.ts`).
- [x] Mettre à jour `package.json` (`version: "1.1.0"`), `README.md` et re-générer les builds CJS/ESM (`npm run build`).
- [ ] Mettre à jour la dépendance dans `package.json` de LexTalk (`"avantgate": "^1.1.0"`).

---

## 🛠️ Plan d'Implémentation

- [x] **Étape 1 : Développement dans le dépôt `avantGate`**
  - Créer `src/prompts/prompt-template.ts` (`PromptTemplate` avec validation d'input Zod et garde anti-injection).
  - Créer `src/prompts/prompt-builder.ts` (`PromptBuilder` fluide par couches avec génération automatique `schemaContract`).
  - Créer l'interface `src/finance/strategy.interface.ts` et le registre `src/finance/factory.ts` (`AccountingFactory`).
  - Implémenter les stratégies concrètes dans `src/finance/strategies/` (`FrenchPCGStrategy`, `UsGAAPStrategy`, `UkIFRSStrategy`, `SwissCOStrategy`).
  - Créer le point d'entrée modulaire `src/finance/index.ts` exportant la factory, les stratégies et les normaliseurs arithmétiques.
  - Étendre `src/security/sanitizer.ts` avec les expressions régulières SPI et NIR pour formulaires fiscaux.
  - Implémenter le flag `features.finance` et `generateStructuredOutput` dans `AvantGateControlLayer`.
- [x] **Étape 2 : Validation & Tests Unitaires du package**
  - Exécuter `npm test` dans `avantGate` (couverture 100% sur les modules core et finance optionnels).
  - Contrôle des types TypeScript (`npm run lint`).
- [x] **Étape 3 : Build Multi-Entrypoint & Publication**
  - Configurer `tsup` pour compiler `src/index.ts` et `src/finance/index.ts` en `dist/` avec déclaration de types séparée.
  - Configurer les `exports` dans `package.json` (`"."` et `"./finance"`).
  - Publier la release sur GitHub (`v1.1.0`) et sur le registre NPM.
- [ ] **Étape 4 : Consommation & Remplacement dans LexTalk**
  - Mettre à jour la dépendance : `npm update avantgate` (v1.1.0).
  - Remplacer l'implémentation de `src/lib/ai/prompts/registry.ts` par `PromptRegistry` d'AvantGate (ou façade réexportante).
  - Remplacer `src/lib/ai/prompt-builder.ts` par le `PromptBuilder` d'AvantGate.
  - Refactoriser `src/lib/services/finance-analyzer/prompt-builder.ts` pour exploiter `PromptBuilder` et `.schemaContract()`.
  - Remplacer `sanitizeAndParseJson` dans `finance-analyzer.service.ts` par `cleanFinancialJSON` et `validateWithZod`.
  - Valider l'ensemble des suites de tests : `npm run test:prompts`, `npm run test:prompt-builder`, `npm run test:finance` et `npx tsc --noEmit`.

---

## 📝 Notes & Décisions Techniques
- **Zero-Dependency** : Conserver le principe fondateur d'AvantGate (aucune dépendance lourde, uniquement Zod en peer/direct dependency).
- **Non-Régression** : `cleanFinancialJSON` ne doit altérer aucun champ texte standard (descriptions, raisons sociales ou observations contenant des parenthèses).

---

## ✅ Vérification & Tests
- [x] Tests unitaires AvantGate 100% verts
- [x] Build `tsup` généré sans erreur
- [ ] Intégration LexTalk validée avec `npm run test:finance` et `npx tsc --noEmit`

---

## 📜 Historique / History

| Date & Heure | Ancien Statut | Nouveau Statut | Auteur | Commentaire / Note |
|---|---|---|---|---|
| 2026-09-10 10:30 | - | TODO | Antigravity | Création initiale du ticket FEAT-184 pour la release AvantGate v1.1.0 |
| 2026-09-11 14:10 | TODO | TODO | Antigravity | Ajout des spécifications détaillées, interfaces TypeScript et exemples de code pour PromptTemplate, PromptBuilder et intégration LexTalk |
| 2026-09-11 14:13 | TODO | IN_PROGRESS | Antigravity | Prise en charge du ticket, élaboration du plan d'implémentation v1.1.0 |
| 2026-09-11 14:26 | IN_PROGRESS | DONE | Antigravity | Implémentation v1.1.0 terminée : Prompt Engine, Finance Normalizer, Guardrails fiscaux, build tsup et tests 100% verts |
| 2026-09-11 15:40 | DONE | DONE | Antigravity | Revue de code & durcissement : immuabilité PromptBuilder, modelOverride ControlLayer, préservation timestamps vs NIR/SPI, et normalisation montants français sans devises |
