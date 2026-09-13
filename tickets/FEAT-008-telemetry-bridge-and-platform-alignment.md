# [FEAT-008]: Pont de Télémétrie HTTP & Alignement SDK avec la Plateforme d'Observabilité SaaS

- **Statut**: DONE <!-- Options: TODO | IN_PROGRESS | IN_REVIEW | DONE -->
- **Priorité**: HIGH <!-- Options: LOW | MEDIUM | HIGH | CRITICAL -->
- **Type**: Feature <!-- Options: Feature | Bug | Refactor | Docs | Chore -->
- **Date de création**: 2026-09-13
- **Assigné à**: Antigravity
- **Dépôt Cible**: [thienban/avantGate](https://github.com/thienban/avantGate)
- **Tickets Liés**: [FEAT-006](file:///c:/Users/Bui/Desktop/DevProjets/avantGate/tickets/FEAT-006-avantgate-agent-submodule.md), [FEAT-007](file:///c:/Users/Bui/Desktop/DevProjets/avantGate/tickets/FEAT-007-agent-tool-chaining-and-circular-guard.md)

---

## 🎯 Objectif & Contexte

Suite à l'implémentation réussie de **FEAT-007** (identification $O(1)$, aliasing/anonymisation, tool chaining, protection anti-cycles et persistance locale DB) et à la spécification technique de la future plateforme SaaS d'Observabilité Open-Core, un pont technique est nécessaire pour harmoniser parfaitement le SDK `avantgate` avec la plateforme `avantgate-platform`.

Ce ticket vise à :
1. **Harmoniser les contrats de données** entre le SDK local (`avantgate/agent`) et le protocole d'ingestion SaaS (`POST /api/v1/ingest/events`).
2. **Enrichir `ToolExecutionRecord` et `StepRecord`** avec les métriques requises par le SaaS (compteur de PII filtrées `piiFilteredCount`, jetons consommés `tokens`, estimation FinOps `costUsd`, et clé unifiée `runId`).
3. **Fournir un Pont d'Export Télémétrique Asynchrone ($0 Dépendance)** : un composant `HttpTelemetryExporter` (ou adaptateur hybride `PlatformStorageAdapter`) capable de batcher et d'expédier les événements vers la plateforme sans jamais bloquer ni ralentir l'exécution de l'agent.
4. **Garantir le principe $0 Infra & Zero-Trust** : le SDK reste 100% autonome et fonctionnel hors-ligne ; l'export vers le cloud ne s'active que sur configuration explicite d'une clé API (`apiKey`).

---

## 📋 Critères d'Acceptation

### 1. Alignement des Modèles de Télémétrie (`types.ts`)
- [x] `ToolExecutionRecord` étendu avec :
  - `runId?: string` (aligné avec `workflowId`, assurant la corrélation immédiate avec les sessions).
  - `piiFilteredCount?: number` (nombre de PII interceptées/masquées lors de l'exécution).
  - `tokens?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }` (pour les sous-outils agents/LLM).
  - `costUsd?: number` (estimation du coût FinOps de l'outil).
- [x] `StepRecord` étendu avec :
  - `runId?: string`.
  - `piiDetectedCount?: number`.
  - `tokens?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }`.
  - `costUsd?: number`.

### 2. Capture Automatique des Métriques PII & FinOps dans le SDK
- [x] Dans `isolated-tool.ts` / `tool-invoker.ts`, capturer le nombre de détections PII issues de `auditToolResult` et l'affecter automatiquement à `record.piiFilteredCount`.
- [x] Permettre à un outil d'injecter ou déclarer ses métriques de consommation (`tokens`, `costUsd`) via `context`.

### 3. Exporteur HTTP Asynchrone (`HttpTelemetryExporter`)
- [x] Implémenter la classe `HttpTelemetryExporter` dans `src/agent/telemetry/` :
  - Configuration : `endpoint?: string` (défaut: `https://api.avantgate.cloud/api/v1/ingest/events`), `apiKey: string`, `batchIntervalMs?: number` (défaut: 5000), `maxBatchSize?: number` (défaut: 50).
  - Mode "Fire-and-Forget" : les envois HTTP (`fetch` standard) s'exécutent en arrière-plan sans bloquer la boucle de réflexion de l'agent.
  - File d'attente circulaire bornée en mémoire : protection contre les fuites de mémoire en cas de coupure réseau.
  - Méthode explicite `flush()` pour vider la file avant la fin du processus.
  - Gestion des erreurs : aucun crash de l'agent en cas d'échec réseau (`onError?: (err: Error) => void`).

### 4. Adaptateur Hybride Plateforme (`PlatformStorageAdapter`)
- [x] Créer un adaptateur `PlatformStorageAdapter` implémentant le port hexagonal `StepStorageAdapter` :
  - Persistance locale immédiate (délégation vers un adapter primaire ex: `SQLiteStorageAdapter` ou `MemoryStorageAdapter`).
  - Transmission simultanée en miroir vers le `HttpTelemetryExporter`.

### 5. Format de Payload Conforme au Protocole d'Ingestion SaaS
- [x] L'exporteur formate les événements selon le schéma attendu par la plateforme :
  - Type `STEP_START` / `STEP_COMPLETED`
  - Type `TOOL_EXECUTION` (avec `toolName`, `durationMs`, `success`, `llmSummary`, `piiFilteredCount`, `tokenCount`, `parentToolId`, `depth`)
  - Type `STEP_APPROVAL_REQUEST` (pour Human-in-the-Loop)
  - Métriques d'usage `usage` consolidées par run.

---

## 🏗️ Architecture & Composants Prévus

```
avantgate/
├── src/agent/
│   ├── types.ts                    # 🔄 Ajout piiFilteredCount, tokens, costUsd, runId
│   ├── isolated-tool.ts            # 🔄 Propagation de piiFilteredCount depuis auditToolResult
│   ├── tool-invoker.ts             # 🔄 Alimentation des métriques dans ToolExecutionRecord
│   ├── step-runner.ts              # 🔄 Enrichissement des événements de steps
│   ├── telemetry/                  # ➕ Nouveau module d'exportation télémétrique
│   │   ├── types.ts                # ➕ Contrat d'événement IngestEvent, BatchPayload
│   │   ├── http-exporter.ts        # ➕ Exporteur HTTP asynchrone non-bloquant
│   │   └── index.ts                # ➕ Exports publics du module telemetry
│   └── adapters/
│       ├── platform-adapter.ts     # ➕ Adaptateur miroir local + export cloud
│       └── index.ts                # 🔄 Export de PlatformStorageAdapter
└── tests/agent/
    ├── telemetry-exporter.test.ts  # ➕ Tests du batching, flush, erreurs réseau et schéma JSON
    └── platform-adapter.test.ts    # ➕ Tests du stockage miroir local + transmission cloud
```

---

## 🛠️ Plan d'Implémentation

- [x] **Phase 1 : Contrats de Types & Métadonnées (`src/agent/types.ts`)**
  - Ajouter `runId`, `piiFilteredCount`, `tokens`, `costUsd` dans `ToolExecutionRecord` et `StepRecord`.
  - Mettre à jour les parseurs et sérialiseurs existants (`SQLiteStorageAdapter`, `PrismaStorageAdapter`, `MemoryStorageAdapter`).

- [x] **Phase 2 : Capture Active des Métriques dans le Runtime**
  - Modifier l'invocation de `auditToolResult` dans `isolated-tool.ts` pour récupérer le `piiCount`.
  - Transmettre ce compteur au `ToolExecutionRecord` créé par `tool-invoker.ts`.

- [x] **Phase 3 : Module d'Exportation Télémétrique (`src/agent/telemetry/`)**
  - Définir les interfaces de payload `TelemetryIngestPayload`, `TelemetryEvent`.
  - Implémenter `HttpTelemetryExporter` avec batching temporisé (5s), seuil d'événements (50 items), et arrêt propre (`shutdown` / `flush`).
  - Assurer la tolérance aux pannes réseau (circuit-breaker souple, pas d'exception non gérée).

- [x] **Phase 4 : `PlatformStorageAdapter` (Pont Hexagonal)**
  - Implémenter l'adaptateur combiné qui sauvegarde dans la base locale et envoie les événements au `HttpTelemetryExporter`.

- [x] **Phase 5 : Tests Unitaires & Intégration**
  - Vérifier que `avantGate` sans clé API reste à $0 infra avec overhead nul.
  - Simuler un endpoint `POST /api/v1/ingest/events` et valider la structure exacte du JSON émis.
  - Tester le flush asynchrone et la résilience aux pannes réseau.

---

## 📜 Historique / History

| Date & Heure | Ancien Statut | Nouveau Statut | Auteur | Commentaire / Note |
|---|---|---|---|---|
| 2026-09-13 14:15 | - | TODO | Antigravity | Création du ticket FEAT-008 pour mettre en cohérence FEAT-007 (SDK Agent) et DESIGN-005 (Plateforme d'Observabilité SaaS) |
| 2026-09-13 14:20 | TODO | IN_PROGRESS | Antigravity | Démarrage des travaux d'implémentation de FEAT-008 |
| 2026-09-13 14:35 | IN_PROGRESS | DONE | Antigravity | Implémentation complète de FEAT-008 validée à 100% (Types, HttpTelemetryExporter, PlatformStorageAdapter, capture PII & 9 suites de tests green) |

