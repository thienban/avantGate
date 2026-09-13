# [FEAT-006]: Implémentation & Architecture du sous-module `avantgate/agent` dans avantGate

- **Statut**: DONE <!-- Options: TODO | IN_PROGRESS | IN_REVIEW | DONE -->
- **Priorité**: HIGH <!-- Options: LOW | MEDIUM | HIGH | CRITICAL -->
- **Type**: Feature <!-- Options: Feature | Bug | Refactor | Docs | Chore -->
- **Date de création**: 2026-09-13
- **Assigné à**: Antigravity
- **Dépôt Cible**: [thienban/avantGate](https://github.com/thienban/avantGate)
- **Spécification de référence**: [DESIGN-004-avantgate-agent-submodule.md](file:///c:/Users/Bui/Desktop/DevProjets/prospectAI/.tickets/DESIGN-004-avantgate-agent-submodule.md)
- **Tickets Liés**: [FEAT-001](file:///c:/Users/Bui/Desktop/DevProjets/prospectAI/.tickets/FEAT-001-step-orchestrator.md), [FEAT-005](file:///c:/Users/Bui/Desktop/DevProjets/prospectAI/.tickets/FEAT-005-agent-data-isolation-harness.md)

---

## 🎯 Objectif & Contexte

Structurer, implémenter et packager le sous-module officiel **`avantgate/agent`** directement au sein de la bibliothèque open-source **`avantGate`** ([github.com/thienban/avantGate](https://github.com/thienban/avantGate)).

Ce sous-module a pour mission d'apporter aux agents TypeScript (notamment basés sur Vercel AI SDK) un harnais de sécurité et d'orchestration durable sans infrastructure additionnelle ($0 Infra, zéro Redis/Temporal) :
1. **Tool Data Isolation & PII Shield** : Masquage automatique des PII dans les retours d'outils et séparation double canal (*Dual-Channel* : résumé booléen/statistique vers le LLM, payload brut complet hors-bande vers le client UI).
2. **Serverless Durable Step Execution** : Exécution mémorielle d'étapes (`step.run()`) et mise en pause native pour approbation humaine (*Human-in-the-Loop* via `step.waitForApproval()`) avec persistance découplée (Ports & Adapters).

---

## 📋 Critères d'Acceptation

### 1. Structure du Package & Subpath Exports
- [x] Le sous-module réside dans `src/agent/` du dépôt `avantGate`.
- [x] Le `package.json` d'`avantGate` expose le subpath export `"./agent"` (types `.d.ts` et build ESM/CJS).
- [x] Le `tsconfig.json` configure les path aliases pour importer proprement `avantgate/agent` en interne et en externe.

### 2. Isolation des Outils (Tool PII Harness)
- [x] Implémentation de `createIsolatedTool(config)` enveloppant les outils du Vercel AI SDK (`ai`).
- [x] Branchement direct sur le moteur `PIIMasker` existant d'`avantGate` pour anonymiser ou masquer les retours texte/objets.
- [x] Séparation étanche : le LLM ne reçoit qu'un message minimaliste (`toLLMSummary`) tandis que les données riches sont acheminées via un callback hors-bande (`toClientData`).

### 3. Orchestration Durable d'Étapes (Step Execution Engine)
- [x] Implémentation de `createStepRunner(config)` fournissant le contexte `step.run()` et `step.waitForApproval()`.
- [x] Mémoïsation des étapes par clé idempotente (`stepId`) : si une étape a déjà réussi, son résultat en base/mémoire est retourné sans réexécution.
- [x] Gestion de l'interruption non-bloquante (`StepSuspendedError`) lors d'un appel à `step.waitForApproval()`.

### 4. Architecture Hexagonale & Adaptateurs de Stockage
- [x] Définition stricte de l'interface `StepStorageAdapter` (Domain/Core).
- [x] Implémentation de `MemoryStorageAdapter` (fourni par défaut pour le dev et les tests unitaires).
- [x] Implémentation de `createCustomStorageAdapter` et `KeyValueStorageAdapter` pour brancher n'importe quel ORM ou store KV.
- [x] Implémentation de `PrismaStorageAdapter` (pour applications Next.js / PostgreSQL / MySQL).
- [x] Implémentation de `SQLiteStorageAdapter` (pour le dev local, desktop ou environnements Edge).

### 5. Qualité, Tests & Documentation
- [x] Suite de tests unitaires complète couvrant le StepRunner, le Tool Isolation, les Patterns et les Adapters.
- [x] Respect strict des standards Clean Code (SRP, fonctions < 20 lignes, early return, interfaces préalables).
- [x] README et exemples d'utilisation complets dans `docs/agent.md`.

---

## 🏗️ Architecture Technique du Sous-Module

```
avantgate/
├── src/
│   ├── index.ts                      # avantgate core (TokenBudget, PIIMasker, Failover)
│   ├── sanitizer.ts                  # Moteur de détection & masquage PII réutilisé
│   └── agent/                        # 🚀 NOUVEAU SOUS-MODULE
│       ├── index.ts                  # Exports publics (createStepRunner, createIsolatedTool...)
│       ├── types.ts                  # Interfaces, StepRecord, StepStorageAdapter
│       ├── errors.ts                 # StepSuspendedError, PiiLeakError, StepExecutionError
│       ├── step-runner.ts            # Implémentation du moteur d'étapes durables
│       ├── isolated-tool.ts          # Wrapper d'outils avec isolation PII & Dual-Channel (Decorator)
│       ├── guardrails.ts             # Audit anti-fuite PII sur les retours d'outils
│       ├── factory.ts                # AgentToolFactory (Injection de contexte & Instanciation)
│       ├── registry.ts               # ToolRegistry (Catalogue centralisé avec permissions)
│       ├── strategy.ts               # ToolSelectionStrategy & implémentations par phase/rôle
│       └── adapters/                 # Adaptateurs de stockage (Ports & Adapters)
│           ├── index.ts
│           ├── memory-adapter.ts     # In-memory storage (Zero-config / Tests)
│           ├── custom-adapter.ts     # Adaptateur custom universel et KeyValue
│           ├── prisma-adapter.ts     # Adapter pour Prisma ORM
│           └── sqlite-adapter.ts     # Adapter pour SQLite (better-sqlite3)
├── tests/
│   └── agent/
│       ├── step-runner.test.ts       # Tests d'idempotence et de reprise après crash
│       ├── isolated-tool.test.ts     # Tests de non-fuite PII vers le LLM
│       ├── tool-patterns.test.ts     # Tests de la Factory, du Registry et des Stratégies
│       └── storage-adapters.test.ts  # Tests des adaptateurs de persistance
├── package.json                      # Subpath exports: "./agent"
└── tsconfig.json
```

---

## 🛠️ Plan d'Implémentation Détaillé

- [x] **Phase 1 : Initialisation & Configuration du Subpath**
  - Configurer `package.json` (`exports`, `typesVersions`, `files`).
  - Configurer `tsconfig.json` (`paths` et `composite`/`declaration`).
  - Mettre en place la configuration de build (`tsup` ou `rollup` / `tsc`).

- [x] **Phase 2 : Définition des Contrats & Types (`types.ts`, `errors.ts`)**
  - Définir l'interface `StepStorageAdapter` (saveStep, getStep, listSteps, updateStepStatus).
  - Définir les types d'état d'étape (`PENDING`, `COMPLETED`, `FAILED`, `WAITING_APPROVAL`).
  - Définir les interfaces de configuration de `createIsolatedTool`, `createStepRunner`, `ToolFactory` et `ToolSelectionStrategy`.

- [x] **Phase 3 : Implémentation du Tool Harness & Decorator (`isolated-tool.ts`, `guardrails.ts`)**
  - Écrire la fonction `createIsolatedTool` compatible avec le format Vercel AI SDK.
  - Implémenter la vérification PII via l'instance `PIIMasker` d'avantGate.
  - Coder le mécanisme de double canal (`toLLMSummary` vs `toClientData`).

- [x] **Phase 4 : Implémentation des Patterns Factory, Registry & Strategy (`factory.ts`, `registry.ts`, `strategy.ts`)**
  - Coder `AgentToolFactory` pour instancier les tools avec injection de contexte (`ToolContext`).
  - Coder `ToolRegistry` pour le catalogue d'outils avec métadonnées et RBAC.
  - Coder les stratégies de sélection d'outils (`ToolSelectionStrategy`) selon la phase du workflow et le rôle.

- [x] **Phase 5 : Implémentation du Step Orchestrator (`step-runner.ts`)**
  - Coder la machine à états de `createStepRunner`.
  - Implémenter `step.run()` avec mémorisation et reprise sur incident.
  - Implémenter `step.waitForApproval()` avec suspension via `StepSuspendedError`.

- [x] **Phase 6 : Implémentation des Adaptateurs de Stockage (`adapters/`)**
  - `MemoryStorageAdapter` avec gestion TTL optionnelle.
  - `createCustomStorageAdapter` et `KeyValueStorageAdapter` pour n'importe quelle DB.
  - `PrismaStorageAdapter` générique acceptant le client Prisma de l'application hôte.
  - `SQLiteStorageAdapter` avec schéma de table automatique `avantgate_steps`.

- [x] **Phase 7 : Tests Unitaires & Intégration Continue**
  - Tests validant le comportement unitaire et l'étanchéité PII.
  - Tests validant le filtrage dynamique des outils par les stratégies.
  - Tests d'intégration démontrant le workflow Human-in-the-Loop complet.

- [x] **Phase 8 : Documentation & Intégration dans `prospectAI`**
  - Rédiger la documentation dans `avantGate/docs/agent.md`.
  - Valider l'import et l'utilisation dans l'application `prospectAI` (`import { createIsolatedTool, createStepRunner, AgentToolFactory } from "avantgate/agent"`).

---

## 📝 Notes & Décisions Techniques

- **Patterns retenus** :
  - *Decorator / Proxy* (`isolated-tool.ts`) : isolation PII transparente sans toucher au code métier de l'outil.
  - *Factory* (`factory.ts`) : instanciation propre avec injection du contexte utilisateur, DB et PII masker.
  - *Registry* (`registry.ts`) : référentiel centralisé des outils avec permissions RBAC associées.
  - *Strategy* (`strategy.ts`) : sélection adaptative du sous-ensemble d'outils injecté au LLM pour économiser les tokens et éliminer les hallucinations.
- **Zéro dépendance d'infrastructure imposée** : Par défaut, `avantgate/agent` fonctionne en mémoire vive (`MemoryStorageAdapter`) sans aucune base de données requise pour les tests et prototypes.
- **Réutilisation de la brique de sécurité** : Utilise le `PIIMasker` déjà validé d'`avantGate` pour garantir une détection robuste des PII.
- **Clean Code & SRP** : Chaque fichier a une responsabilité unique, aucune fonction ne dépasse 20 lignes sans extraction, early returns systématiques.

---

## ✅ Vérification & Tests

- [x] Compilation TypeScript (`tsc --noEmit` et `build`) réussie sans avertissement ni erreur de type.
- [x] 100% des tests unitaires `tests/agent/*.test.ts` au vert.
- [x] Vérification que le subpath `import { ... } from "avantgate/agent"` résout correctement les types dans un projet externe.

---

## 📜 Historique / History

| Date & Heure | Ancien Statut | Nouveau Statut | Auteur | Commentaire / Note |
|---|---|---|---|---|
| 2026-09-13 10:45 | - | TODO | Antigravity | Création du ticket d'architecture et d'implémentation du sous-module `avantgate/agent` |
| 2026-09-13 10:47 | TODO | TODO | Antigravity | Intégration des design patterns Factory, Registry et Strategy pour la gestion des tools |
| 2026-09-13 11:22 | TODO | IN_PROGRESS | Antigravity | Prise en charge et lancement de l'implémentation du sous-module avantgate/agent |
| 2026-09-13 11:28 | IN_PROGRESS | DONE | Antigravity | Sous-module avantgate/agent implémenté, build tsup réussi, 100% des tests au vert |
