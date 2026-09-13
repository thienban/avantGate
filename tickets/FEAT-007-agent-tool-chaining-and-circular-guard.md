# [FEAT-007]: Tool ID, Aliasing/Anonymisation, Tool Chaining, Protection Anti-Cycles & Persistance DB dans `avantgate/agent`

- **Statut**: DONE <!-- Options: TODO | IN_PROGRESS | IN_REVIEW | DONE -->
- **Priorité**: HIGH <!-- Options: LOW | MEDIUM | HIGH | CRITICAL -->
- **Type**: Feature <!-- Options: Feature | Bug | Refactor | Docs | Chore -->
- **Date de création**: 2026-09-13
- **Assigné à**: Antigravity
- **Dépôt Cible**: [thienban/avantGate](https://github.com/thienban/avantGate)
- **Tickets Liés**: [FEAT-006](file:///c:/Users/Bui/Desktop/DevProjets/avantGate/tickets/FEAT-006-avantgate-agent-submodule.md), [FEAT-008](file:///c:/Users/Bui/Desktop/DevProjets/avantGate/tickets/FEAT-008-telemetry-bridge-and-platform-alignment.md), [DESIGN-005](file:///c:/Users/Bui/Desktop/DevProjets/avantGate/tickets/DESIGN-005-agent-data-observability-platform.md)

---

## 🎯 Objectif & Contexte

Dans les architectures d'agents autonomes avancées, les outils ne sont plus de simples fonctions isolées : ils collaborent, s'enchaînent et manipulent des données critiques. Ce fonctionnement soulève quatre défis majeurs de robustesse, de sécurité et de persistance :

1. **Identification Key-Value $O(1)$ & Rétrocompatibilité (`id`)** :
   - Indexer les outils par un identifiant immuable et stable (`id`, ex: `tool_crm_01`) pour un accès instantané par table de hachage, des traces d'audit télémétriques précises, et des invocations programmatiques fiables.
   - Préserver la rétrocompatibilité : si `id` est omis, il hérite automatiquement du champ `name`.
2. **Anonymisation & Aliasing Bidirectionnel (`alias` / `publicName`)** :
   - Les noms d'outils internes révèlent souvent l'architecture technique ou des tables confidentielles (ex: `query_sap_hana_v2`, `stripe_charge_customer`).
   - Permettre de masquer/anonymiser le nom envoyé au LLM (ex: `lookup_employee` ou `tool_1`) pour la sécurité (anti-reconnaissance), la clarté du prompt et l'économie de tokens, tout en maintenant un proxy de résolution bidirectionnel transparent vers l'outil réel.
3. **Composition d'Outils (Tool Chaining Concurrence-Safe)** :
   - Permettre à un outil complexe d'appeler d'autres sous-outils via son contexte d'exécution (`context.callTool(toolId, args)`).
   - Chaîne d'appel immuable (`readonly string[]`) garantissant la sécurité lors d'exécutions parallèles (`Promise.all`).
4. **Protection contre les Cycles d'Appels & Références Circulaires** :
   - Détecter et bloquer immédiatement les boucles infinies d'outils (`Tool A -> Tool B -> Tool A`) via un graphe acyclique, une profondeur maximale (`maxCallDepth`) et un plafond total d'appels (`maxTotalSubCalls`).
   - Protéger le moteur d'inspection PII (`guardrails.ts`) contre les objets récursifs contenant des références circulaires en mémoire (`obj.self = obj`) via un `WeakSet`.
5. **Persistance en Base de Données & Mémoire d'Exécution des Tools** :
   - **Traçabilité Hiérarchique en DB** : Enregistrer chaque exécution d'outil avec son `parentToolId`, durée, arguments et résumé.
   - **Cache & Idempotence des Tools en DB** : Mémoïser le résultat des sous-outils coûteux via un `cacheTTL` pour éviter de réexécuter des requêtes payantes lors d'un crash ou re-jeu de workflow.
   - **Mémoire Partagée Inter-Outils (Blackboard Pattern)** : Permettre aux outils d'échanger des données riches en DB (`context.state.get/set`) sans polluer le contexte du LLM.

---

## 📋 Critères d'Acceptation

### 1. Identifiant Unique `id` & Double Indexation Key-Value
- [x] `createIsolatedTool` accepte `id?: string` et `name: string`. Si `id` est omis, `id = name` par défaut (zéro breaking change).
- [x] Le `ToolRegistry` indexe en $O(1)$ par `id` (`getById(id)`) et par nom public/alias (`getByPublicName(name)`).
- [x] Télémétrie et logs reliés à l'`id` immuable.

### 2. Aliasing & Anonymisation Bidirectionnelle
- [x] `createIsolatedTool` accepte un paramètre optionnel `alias?: string` (nom simplifié/anonymisé vu par le LLM).
- [x] Le `ToolRegistry` fournit une méthode `toRecord({ anonymize?: boolean })` qui expose les outils au format Vercel AI SDK sous leur alias public.
- [x] Lorsqu'un LLM appelle le nom aliasé, AvantGate achemine automatiquement l'appel vers l'implémentation de l'outil réel.

### 3. Composition d'Outils (Tool Chaining) & Concurrence
- [x] `ToolExecutionContext` expose `callTool<TResult = unknown>(toolId: string, args: unknown): Promise<TResult>`.
- [x] La chaîne d'appel `callChain` est immuable pour supporter sans corruption les appels concurrents (`Promise.all([context.callTool(...), context.callTool(...)])`).
- [x] L'isolation PII et les callbacks Dual-Channel restent appliqués à chaque niveau d'invocation.

### 4. Détection de Boucles d'Appels & Call Stack Guard
- [x] Détection immédiate des cycles récursifs (`CircularToolCallError` sur `A -> B -> A`).
- [x] Configuration d'une profondeur maximale (`maxCallDepth`, défaut: 5) levant `ToolCallDepthExceededError`.
- [x] Configuration d'un plafond global de sous-appels (`maxTotalSubCalls`, défaut: 20).

### 5. Protection Mémoire Anti-Cycle (`WeakSet`) dans les Guardrails PII
- [x] `auditToolResult` utilise un `WeakSet` pour mémoriser les objets déjà inspectés.
- [x] Si une référence circulaire d'objet est détectée (`obj.self = obj`), elle est élidée proprement (`"[CIRCULAR_REFERENCE]"`) sans boucle infinie ni crash `RangeError: Maximum call stack size exceeded`.

### 6. Persistance Base de Données & Mémoire d'Exécution des Tools
- [x] Définition de l'interface `ToolExecutionRecord` (traçabilité avec `executionId`, `workflowId`, `toolId`, `parentToolId`, `depth`, `durationMs`, `status`, `error`).
- [x] Extension du port `StepStorageAdapter` (ou adaptateur dédié) pour persister les exécutions d'outils (`saveToolExecution`, `listToolExecutions`).
- [x] Support du cache d'idempotence d'outil (`cacheTTL` en secondes) : si un résultat valide est en base pour `hash(toolId + args)`, le calcul n'est pas réexécuté.
- [x] API de Blackboard / État partagé persistant : `context.state.get(key)` et `context.state.set(key, value, ttl?)`.

---

## 🏗️ Architecture & Composants Impactés

```
avantgate/
├── src/agent/
│   ├── types.ts              # 🔄 id, alias, ToolExecutionRecord, ToolExecutionContext.callTool, state
│   ├── errors.ts             # ➕ CircularToolCallError, ToolCallDepthExceededError, ToolSubCallQuotaError
│   ├── guardrails.ts         # 🔄 WeakSet de visite anti-référence circulaire d'objet
│   ├── isolated-tool.ts      # 🔄 Support de id, alias, cacheTTL et injection du context étendu
│   ├── registry.ts           # 🔄 Double indexation O(1) (byId, byPublicName) + export anonymisé
│   ├── tool-invoker.ts       # ➕ Dispatcher sécurisé, cycle guard & journalisation DB
│   ├── tool-state.ts         # ➕ Blackboard / Mémoire partagée inter-outils
│   ├── adapters/             # 🔄 Sauvegarde des ToolExecutionRecords et cache d'idempotence
│   │   ├── memory-adapter.ts
│   │   ├── custom-adapter.ts
│   │   ├── prisma-adapter.ts
│   │   └── sqlite-adapter.ts
│   └── factory.ts            # 🔄 Propagation du storage et du dispatcher aux outils instanciés
└── tests/agent/
    ├── tool-chaining.test.ts # ➕ Tests exhaustifs de Tool Chaining, cycles et profondeur
    ├── tool-aliasing.test.ts # ➕ Tests d'anonymisation, alias et lookup O(1) par id
    └── tool-storage.test.ts  # ➕ Tests de persistance DB des traces, cache d'idempotence et blackboard
```

---

## 🛠️ Plan d'Implémentation Détaillé

- [x] **Phase 1 : Contrats de Types, Rétrocompatibilité & Erreurs (`types.ts`, `errors.ts`)**
  - Ajouter `id?: string` et `alias?: string` dans `IsolatedToolConfig` (avec fallback `id = id ?? name`).
  - Définir `ToolExecutionRecord` et l'interface de state persistant `ToolSharedState`.
  - Étendre `ToolExecutionContext` avec `callTool`, `callChain: readonly string[]`, et `state`.
  - Créer `CircularToolCallError`, `ToolCallDepthExceededError`, `ToolSubCallQuotaError`.

- [x] **Phase 2 : Sécurisation Mémoire des Guardrails PII (`guardrails.ts`)**
  - Passer un `WeakSet<object>` à travers `recursivelySanitize`.
  - Si un objet a déjà été visité, retourner `"[CIRCULAR_REFERENCE]"` et `count: 0`.

- [x] **Phase 3 : Indexation Key-Value & Aliasing dans `ToolRegistry`**
  - Implémenter les Maps internes `toolsById = new Map<string, RegisteredTool>()` et `toolsByPublicName = new Map<string, RegisteredTool>()`.
  - Méthodes `getById(id)` et `getByPublicName(name)`.
  - Méthode `toRecord({ anonymize?: boolean })` générant le mapping aliasé pour le LLM.

- [x] **Phase 4 : Moteur d'Invocation Sécurisé, Cycle Guard & Concurrence (`tool-invoker.ts`)**
  - Implémenter `createToolInvoker(registry, storage, options)`.
  - Chaîne d'appel immuable `[...parentChain, currentToolId]`.
  - Détecter les cycles : `if (parentChain.includes(targetToolId)) throw new CircularToolCallError(...)`.
  - Vérifier la profondeur et le quota global de sous-appels.

- [x] **Phase 5 : Persistance DB des Outils & Cache d'Idempotence**
  - Enregistrer chaque exécution d'outil dans le storage (`saveToolExecution`).
  - Gérer la mémoïsation par hash des arguments si `cacheTTL` est activé sur l'outil.
  - Mettre en place le Blackboard partagé (`context.state.get/set`).
  - Mettre à jour `MemoryStorageAdapter`, `SQLiteStorageAdapter` et `PrismaStorageAdapter`.

- [x] **Phase 6 : Tests Unitaires & Intégration Continue**
  - `tests/agent/tool-aliasing.test.ts` : Lookup $O(1)$ par `id`, résolution d'alias bidirectionnel, anonymisation des prompts LLM.
  - `tests/agent/tool-chaining.test.ts` : Tool Chaining direct, `Promise.all` concurrent, détection de cycle `A -> B -> A`, limite de profondeur `maxCallDepth`.
  - `tests/agent/tool-storage.test.ts` : Persistance DB de l'arbre d'exécution (`parentToolId`), cache d'idempotence `cacheTTL`, partage d'état blackboard.

- [x] **Phase 7 : Documentation & Exemples**
  - Mettre à jour `docs/agent.md` avec des exemples d'ID stables, d'aliasing anonymisé, de Tool Chaining et de persistance DB des traces d'outils.

---

## 📜 Historique / History

| Date & Heure | Ancien Statut | Nouveau Statut | Auteur | Commentaire / Note |
|---|---|---|---|---|
| 2026-09-13 11:42 | - | TODO | Antigravity | Création du ticket FEAT-007 pour le Tool Chaining et la protection anti-cycles/références circulaires |
| 2026-09-13 11:48 | TODO | TODO | Antigravity | Enrichissement du ticket : ajout du Tool ID immuable, double indexation O(1) et aliasing/anonymisation bidirectionnelle pour le LLM |
| 2026-09-13 11:50 | TODO | TODO | Antigravity | Enrichissement majeur : ajout de la persistance DB des tool executions (arbre hiérarchique), cache d'idempotence, blackboard partagé et concurrence-safe |
| 2026-09-13 11:51 | TODO | IN_PROGRESS | Antigravity | Prise en charge et démarrage de l'implémentation de FEAT-007 |
| 2026-09-13 12:02 | IN_PROGRESS | DONE | Antigravity | Implémentation complète de FEAT-007 : Tool ID, Aliasing, Chaining, Anti-Cycles & Persistance DB validés à 100% |
