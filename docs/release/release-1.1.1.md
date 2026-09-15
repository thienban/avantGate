# 🚀 AvantGate v1.1.1 — Notes de Version (Release Notes)

> **Date de publication** : 15 Septembre 2026  
> **Package NPM** : [`avantgate@1.1.1`](https://www.npmjs.com/package/avantgate)  
> **Type de Release** : Correctifs Critiques (Bugfix), Sécurité Budgétaire & Améliorations Architecturales

---

## 📌 Résumé Exécutif

La version **v1.1.1** d'AvantGate apporte des correctifs fondamentaux répondant directement aux retours d'onboarding et d'audit technique d'utilisateurs externes :
1. **Délivrance de la promesse n°1 ("Pre-Flight In-Process Gating")** : les limites `maxTokenBudget` et `maxCostUSD` bloquent désormais réellement les requêtes en amont, avant toute dépense API.
2. **Fin de la simulation factice silencieuse** : suppression du repli automatique sur `executeSimulation()`. Si aucun fournisseur n'est configuré, AvantGate lève une exception explicite `ConfigurationError`.
3. **Dispatch HTTP Natif ($0 Dépendance)** : un client `fetch` intégré permet d'exécuter directement les appels pour DeepSeek, Mistral, OpenAI, Ollama et OpenRouter sans installer de SDK tiers.
4. **Moteur Tarifaire "Strict & Truthful" & Adaptateur DB** : suppression des prix codés en dur dans le moteur au profit d'un registre découplé et d'un `PricingAdapter` connectable à votre base de données (ex: Prisma, PostgreSQL) avec cache mémoire à 0 ms de latence.
5. **Rectification de l'Installation** : clarification définitive du nom de publication `avantgate` (résolution du 404 sur `@avantgate/core`).

---

## 🔍 Détail des Corrections & Nouvelles Fonctionnalités

### 1. 🛡️ Garde Pré-Vol Active (`maxTokenBudget` & `maxCostUSD`)
- **Problème résolu** : Précédemment, `maxTokenBudget` et `maxCostUSD` n'étaient définis que dans les types TypeScript (`.d.ts`) mais n'étaient jamais évalués au runtime. Une requête avec `maxTokenBudget: 1` retournait un résultat sans jamais bloquer.
- **Comportement v1.1.1** :
  - **Évaluation pré-vol** : Avant d'envoyer la moindre requête au fournisseur, AvantGate estime la taille en jetons du prompt (`Math.ceil(chars / 4)`).
  - **Blocage Token** : Si `promptTokens > maxTokenBudget`, une exception `BudgetExceededError` est levée instantanément.
  - **Blocage Coût** : Si le coût d'entrée estimé dépasse `maxCostUSD`, la requête est bloquée net.
  - **Plafonnement de complétion** : La complétion est bornée pour ne pas déborder du solde disponible.
  - **Contrôle post-exécution** : Vérification stricte des tokens réels et du coût total retournés par le provider.

```typescript
import { createAvantGate, BudgetExceededError } from "avantgate";

const control = createAvantGate({
  primary: { provider: "deepseek", model: "deepseek-chat", apiKey: process.env.DEEPSEEK_API_KEY! },
  maxTokenBudget: 100,
  maxCostUSD: 0.001,
});

try {
  await control.execute({ userQuery: "Analyse exhaustive de 50 pages de contrat..." });
} catch (error) {
  if (error instanceof BudgetExceededError) {
    console.warn("Bloqué en pré-vol par AvantGate :", error.message);
  }
}
```

---

### 2. 🚫 Suppression de la Simulation Silencieuse
- **Problème résolu** : En l'absence de client instancié, `execute()` basculait silencieusement sur `this.executeSimulation()`, produisant une réponse factice avec un décompte de tokens et un coût calculé, même avec une clé API bidon.
- **Comportement v1.1.1** :
  - Le repli silencieux vers `executeSimulation()` est **définitivement supprimé** du flux de production.
  - Si aucun fournisseur n'est opérationnel, AvantGate lève une `ConfigurationError` explicite :
    ```
    [AvantGate Configuration Error] No active LLM provider configured. Provide a client implementing LLMProviderPort or configure credentials (apiKey / baseUrl).
    ```
  - La simulation factice devient un outil de test réservé aux environnements de CI/bancs d'essai, activable uniquement via l'option explicite `mockSimulation: true`.

---

### 3. 🌐 Client HTTP Natif Intégré ($0 Dépendance, Node 18+ `fetch`)
- **Problème résolu** : Le quickstart du README suggérait de passer `apiKey: process.env.DEEPSEEK_API_KEY!` sans expliquer comment instancier le client.
- **Comportement v1.1.1** :
  - Implémentation de `HttpProviderClient` compatible avec le protocole `/chat/completions`.
  - Prise en charge native de **DeepSeek**, **Mistral**, **OpenAI**, **Ollama** et **OpenRouter**.
  - Si un utilisateur fournit `apiKey` (ou `baseUrl` pour Ollama), AvantGate instancie automatiquement le client HTTP natif.
  - Les erreurs du fournisseur (HTTP 401 Unauthorized sur clé invalide, HTTP 429 Rate Limit, HTTP 500) sont fidèlement captées et déclenchent la bascule automatique sur fallback si configuré.

---

### 4. 💰 Moteur Tarifaire "Strict & Truthful" & Adaptateur DB (`PricingAdapter`)
- **Problème résolu** : Les prix étaient codés en dur dans un dictionnaire `BASELINE_PRICES`. Ces prix devenaient rapidement obsolètes et ne prenaient pas en compte les marges des distributeurs (ex: OpenRouter) ou les remises négociées en entreprise.
- **Comportement v1.1.1** :
  - **Suppression du dictionnaire codé en dur** : `PricingRegistry` démarre 100% vide. Aucun prix approximatif ou périmé n'est inventé (coût = `$0.00` si non configuré).
  - **Exigence de vérité avec `maxCostUSD`** : Si un plafond de coût est défini, AvantGate exige que le modèle soit tarifé pour éviter tout calcul erroné.
  - **Interface `PricingAdapter` pour base de données (ex: Prisma LexTalk)** :
    ```typescript
    const control = createAvantGate({
      primary: { provider: "deepseek", model: "deepseek-chat", apiKey: process.env.DEEPSEEK_API_KEY! },
      pricingAdapter: {
        async fetchPrice(model, provider) {
          const row = await prisma.modelPricing.findFirst({ where: { model, distributor: provider } });
          if (!row) return undefined;
          return {
            promptUSDPerMillion: Number(row.promptPriceUSDPerM),
            completionUSDPerMillion: Number(row.completionPriceUSDPerM),
          };
        },
      },
      pricingCacheTtlMs: 5 * 60 * 1000, // Cache mémoire 5 min (0 ms de latence, 0 requête DB par prompt)
    });
    ```
  - **Support des clés hiérarchiques** : `distributeur/modele` (ex: `openrouter/deepseek/deepseek-chat`, `azure/gpt-4o`).
  - **Jeu de données initial exporté** : `SEED_MODEL_PRICES` est exporté pour alimenter vos scripts de seed de base de données.

---

### 5. 📦 Package & Installation
- **Problème résolu** : Certaines annonces et références mentionnaient `@avantgate/core` qui renvoyait une erreur HTTP 404 sur npmjs.com.
- **Comportement v1.1.1** :
  - La documentation et le `package-lock.json` sont alignés sur le nom officiel publié sur npm :
    ```bash
    npm install avantgate zod
    ```

---

## 🧪 Matrice de Tests & Vérification

| Suite de Tests | Statut | Couverture |
|---|:---:|---|
| `tests/preflight-budget.test.ts` | ✅ **PASS** | Rejet pré-vol `maxTokenBudget: 1`, rejet `maxCostUSD`, levée de `ConfigurationError`, test du cache TTL `PricingAdapter`, et mock HTTP 401. |
| `tests/avantgate.test.ts` | ✅ **PASS** | Contrôleur principal, bascule automatique multi-modèles (failover 429), masqueur PII, garde anti-injection, Zod repair. |
| `tests/financial-normalizer.test.ts` | ✅ **PASS** | Normalisation comptable française, parenthèses négatives, k€ / M€. |
| `tests/prompt-builder.test.ts` | ✅ **PASS** | Assemblage de prompts structurés, slots de tokens, templates versionnés. |
| `tests/pii-extended.test.ts` | ✅ **PASS** | Détection et masquage NIR/Sécu, SPI fiscal, IBAN, BIC. |
| `tests/agent/*` (9 fichiers) | ✅ **PASS** | StepRunner durable, HITL, isolation Dual-Channel, anti-cycles, PlatformStorageAdapter, HttpTelemetryExporter. |
| `npm run build` | ✅ **PASS** | Génération des bundles CJS, ESM et fichiers de types `.d.ts`. |

---

## 📚 Documentation Associée
- [Guide Complet de Tarification & DB Setup](file:///c:/Users/Bui/Desktop/DevProjets/avantGate/docs/pricing.md)
- [Module Agent Durable & Observabilité](file:///c:/Users/Bui/Desktop/DevProjets/avantGate/docs/agent.md)
- [Ticket de Développement FEAT-009](file:///c:/Users/Bui/Desktop/DevProjets/avantGate/tickets/FEAT-009-preflight-budget-guard-distributor-pricing-and-native-dispatch.md)
