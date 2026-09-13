# [DESIGN-005]: Plateforme d'Observabilité & Gouvernance des Agents et des Données (avantGate Control Plane)

- **Statut**: APPROVED <!-- Options: TODO | IN_PROGRESS | IN_REVIEW | APPROVED -->
- **Priorité**: HIGH <!-- Options: LOW | MEDIUM | HIGH | CRITICAL -->
- **Type**: Technical Design <!-- Options: Architecture | Technical Design | UI/UX Spec | RFC -->
- **Date de création**: 2026-09-13
- **Assigné à**: Antigravity
- **Dépôt Cible**: `avantgate-platform` (Dépôt Privé SaaS) & `thienban/avantGate` (SDK Public)
- **Spécifications de référence**: [DESIGN-003](file:///c:/Users/Bui/Desktop/DevProjets/prospectAI/.tickets/DESIGN-003-agent-data-isolation-harness.md), [DESIGN-004](file:///c:/Users/Bui/Desktop/DevProjets/prospectAI/.tickets/DESIGN-004-avantgate-agent-submodule.md)
- **Tickets Liés**: [FEAT-006](file:///c:/Users/Bui/Desktop/DevProjets/avantGate/tickets/FEAT-006-avantgate-agent-submodule.md), [FEAT-007](file:///c:/Users/Bui/Desktop/DevProjets/avantGate/tickets/FEAT-007-agent-tool-chaining-and-circular-guard.md), [FEAT-008](file:///c:/Users/Bui/Desktop/DevProjets/avantGate/tickets/FEAT-008-telemetry-bridge-and-platform-alignment.md)

---

## 📌 1. Vision Produit & Modèle Économique (Open-Core SaaS)

### 1.1. Problématique & Opportunité
Lorsqu'une organisation passe des agents IA en production (avec le Vercel AI SDK et `avantgate/agent`), elle fait face à un quadruple angle mort :
1. **Opacité de l'exécution agentique** : Impossibilité de tracer la chaîne causale des sous-étapes, les décisions des outils (*tool calling*), les tokens consommés et les latences cumulées.
2. **Fuites de données et conformité (PII & RGPD)** : Absence de preuve d'audit garantissant qu'aucune donnée confidentielle issue des outils n'a été réinjectée dans le contexte du LLM.
3. **Blocage des processus Human-in-the-Loop** : Absence d'interface centralisée pour approuver ou rejeter en temps réel des actions sensibles en attente (`step.waitForApproval()`).
4. **Surchauffe financière et boucles infinies** : Risque d'agents qui tournent en boucle sur un même outil ou dépassent les budgets autorisés sans disjoncteur automatique.

### 1.2. La Séparation Public / Privé (Open-Core)
Pour bâtir un business SaaS viable et protéger la propriété intellectuelle :
- **Dépôt Public (`avantGate`)** : Le SDK client open-source ($0 infra, sans base obligatoire) qui gouverne les flux LLM et isole les PII en mémoire, doté de `PlatformStorageAdapter` et `HttpTelemetryExporter` (implémentés dans FEAT-008).
- **Dépôt Privé (`avantgate-platform`)** : La plateforme SaaS hébergée (ou On-Premise Enterprise) comprenant le Dashboard Next.js, le backend FastAPI d'ingestion haute fréquence, le moteur FinOps, le Session Replay hiérarchique, l'inbox Human-in-the-Loop et la facturation multi-tenants Stripe.

```
┌────────────────────────────────────────┐       ┌────────────────────────────────────────┐
│  📦 SDK Public (thienban/avantGate)    │       │  🔒 Plateforme SaaS Privée             │
│  - Masquage PII local ($0 infra)       │       │  - Dashboard Web Next.js 15            │
│  - Durable Steps (`step.run`)          │ ───►  │  - FinOps & Cost Engine (Helicone-like)│
│  - HttpTelemetryExporter & Platform    │ HTTPS │  - Session Replay (AgentOps-like)      │
│    StorageAdapter (`apiKey: "ag_..."`) │       │  - Human-in-the-Loop Mission Control   │
└────────────────────────────────────────┘       └────────────────────────────────────────┘
```

---

## 🏗️ 2. Architecture Globale du Système

```mermaid
graph TD
    subgraph ClientApplications["Applications Clientes (prospectAI / Node / Python)"]
        AgentSDK["avantgate/agent (SDK Client)"]
        PlatformAdapter["PlatformStorageAdapter (Miroir Hexagonal)"]
        LocalStorage["Stockage Local (SQLite / Prisma / Memory)"]
        TelemetryBuffer["HttpTelemetryExporter (Batching Asynchrone)"]

        AgentSDK --> PlatformAdapter
        PlatformAdapter --> LocalStorage
        PlatformAdapter --> TelemetryBuffer
    end

    subgraph AvantGateSaaS["avantgate-platform (Dépôt Privé SaaS)"]
        subgraph IngestionGateway["Passerelle d'Ingestion"]
            IngressAPI["FastAPI / Next.js Ingestion Route (:8000)"]
            AuthMiddleware["Auth & API Key Validator (ag_live_...)"]
            IngressAPI --> AuthMiddleware
        end

        subgraph BackgroundProcessors["Moteurs de Traitement & Analyse"]
            CostCalculator["FinOps Engine (Calcul au centime)"]
            LoopShield["Infinite Loop Shield (Détection d'anomalies)"]
            PiiAuditLog["PII Compliance Auditor"]
            ApprovalNotifier["Human-in-the-Loop SSE Gateway"]
        end

        subgraph StorageLayer["Stockage Multi-Tenants"]
            PostgresDB[("PostgreSQL 16 (Workspaces, Users, Approvals, Tool Metrics)")]
            ClickHouseDB[("ClickHouse (Analytique haute fréquence & Spans)")]
            RedisCache[("Redis (Rate-limiting & Clés API en cache)")]
        end

        subgraph FrontendUI["Console Web SaaS (Next.js 15 App Router)"]
            FinOpsDashboard["Dashboard FinOps & Tokens"]
            SessionReplay["Session Replay & Timeline Graph"]
            ToolHealth["Tool Health & Latency Explorer"]
            PiiInspector["Dual-Channel PII Inspector"]
            ApprovalInbox["Human Gate Validation Inbox"]
        end
    end

    TelemetryBuffer -->|POST /api/v1/ingest/events| IngressAPI
    AuthMiddleware --> CostCalculator
    AuthMiddleware --> LoopShield
    AuthMiddleware --> PiiAuditLog

    CostCalculator --> PostgresDB
    CostCalculator --> ClickHouseDB
    LoopShield --> PostgresDB
    AuthMiddleware --> RedisCache

    ApprovalNotifier -->|SSE Realtime| ApprovalInbox
    FrontendUI -->|REST / TanStack Query| IngressAPI
```

---

## 🚀 3. Blueprint d'Initialisation du Projet Privé (`avantgate-platform`)

### 3.1. Structure du Répertoire (Monorepo Turborepo + pnpm)
Le dépôt privé est hébergé dans un dossier dédié (ex: `C:\Users\Bui\Desktop\DevProjets\avantgate-platform`) :

```
avantgate-platform/
├── apps/
│   ├── web/                           # Dashboard SaaS (Next.js 15, Tailwind, shadcn/ui)
│   │   ├── app/
│   │   │   ├── (auth)/                # Login, Register, Invitation
│   │   │   ├── (dashboard)/
│   │   │   │   ├── dashboard/         # Vue FinOps globale (Coûts, Tokens)
│   │   │   │   ├── sessions/          # Sessions & Session Replay pas-à-pas
│   │   │   │   │   └── [sessionId]/   # Magnétoscope d'exécution
│   │   │   │   ├── tools/             # Santé des outils, latences, échecs
│   │   │   │   ├── security/          # Dual-Channel PII Inspector (RGPD)
│   │   │   │   ├── approvals/         # Human-in-the-Loop Mission Control
│   │   │   │   └── settings/          # Clés API, Membres, Facturation Stripe
│   │   │   └── api/                   # Route handlers Next.js internes
│   │   ├── components/
│   │   │   ├── ui/                    # Composants shadcn/ui bruts
│   │   │   ├── features/              # Composants métiers (Replay, Timeline, Charts)
│   │   │   └── shared/                # Layouts, Header, Sidebar
│   │   └── package.json
│   └── api/                           # Backend Haute Performance d'Ingestion (FastAPI)
│       ├── app/
│       │   ├── domain/                # Modèles métiers purs & Interfaces abstraites
│       │   ├── use_cases/             # Ingestion, Calcul de coût, Détection de boucle
│       │   ├── infrastructure/        # Connexions PostgreSQL, ClickHouse, Redis
│       │   └── interfaces/rest/       # Endpoints REST (/api/v1/ingest, /api/v1/approvals)
│       └── pyproject.toml             # Dépendances Poetry (FastAPI, Pydantic v2, asyncpg)
├── packages/
│   ├── database/                      # Schémas Prisma / SQLAlchemy & Migrations
│   │   ├── prisma/schema.prisma
│   │   └── package.json
│   └── shared-types/                  # Interfaces TypeScript & Schémas Zod partagés
│       ├── src/index.ts
│       └── package.json
├── docker-compose.yml                 # PostgreSQL, ClickHouse, Redis pour dev local
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

---

### 3.2. Guide de Démarrage Pas-à-Pas (Commandes de Bootstrap)

#### Étape 1 : Initialiser le Monorepo
```bash
# 1. Créer le dossier racine du projet privé
mkdir C:\Users\Bui\Desktop\DevProjets\avantgate-platform
cd C:\Users\Bui\Desktop\DevProjets\avantgate-platform

# 2. Initialiser Git et pnpm
git init
pnpm init
```

#### Étape 2 : Initialiser le Dashboard Frontend (Next.js 15)
```bash
# Création de l'application Next.js 15 dans apps/web
npx create-next-app@latest apps/web --typescript --tailwind --eslint --app --src-dir=false --import-alias="@/*"

# Installation des dépendances UI standard
cd apps/web
pnpm add @tanstack/react-query zustand clsx tailwind-merge lucide-react recharts
pnpm add zod react-hook-form @hookform/resolvers

# Installation de shadcn/ui
npx shadcn@latest init
npx shadcn@latest add button card table badge dialog dropdown-menu tabs input avatar
```

#### Étape 3 : Initialiser le Backend d'Ingestion (FastAPI + Poetry)
```bash
# Dans apps/api
cd ../../apps/api
poetry init --name "avantgate-api" --dependency "fastapi" --dependency "uvicorn[standard]" --dependency "pydantic>=2.0" --dependency "asyncpg" --dependency "redis"
poetry install
```

#### Étape 4 : Fichier `docker-compose.yml` (Services Locaux)
```yaml
version: "3.8"
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: avantgate
      POSTGRES_PASSWORD: avantgate_secret
      POSTGRES_DB: avantgate_saas
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

---

## 🗄️ 4. Modèle de Données Multi-Tenant (PostgreSQL)

Schéma relationnel gérant les organisations, la facturation et les exécutions :

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   workspaces    │───┬──<│    api_keys     │       │      users      │
│ - id (UUID)     │   │   │ - id (UUID)     │       │ - id (UUID)     │
│ - name          │   │   │ - key_hash      │       │ - email         │
│ - slug          │   │   │ - prefix        │       └────────┬────────┘
│ - plan (FREE...)│   │   │ - is_revoked    │                │
│ - stripe_sub_id │   │   └─────────────────┘                │
└────────┬────────┘   │                                      ▼
         │            │   ┌─────────────────┐       ┌─────────────────┐
         │            └──<│  session_runs   │       │workspace_members│
         │                │ - id (UUID)     │       │ - workspace_id  │
         ▼                │ - run_id (ext)  │       │ - user_id       │
┌─────────────────┐       │ - status        │       │ - role (ADMIN..)│
│approval_requests│       │ - total_cost    │       └─────────────────┘
│ - id (UUID)     │       │ - total_tokens  │
│ - run_id        │       └────────┬────────┘
│ - status        │                │
│ - payload_sum   │                ▼
│ - decided_by    │       ┌─────────────────┐
└─────────────────┘       │   step_spans    │
                          │ - id (UUID)     │
                          │ - step_name     │
                          │ - cost_usd      │
                          │ - tool_calls    │
                          └─────────────────┘
```

---

## 📡 5. Protocole d'Ingestion Télémétrique (API SDK ➔ SaaS)

### 5.1. Initialisation dans le SDK Client (`avantgate/agent`)
Grâce à **FEAT-008**, l'intégration côté client s'effectue via l'adaptateur hybride :

```typescript
import {
  PlatformStorageAdapter,
  SQLiteStorageAdapter,
  HttpTelemetryExporter,
  createStepRunner,
} from "avantgate/agent";
import Database from "better-sqlite3";

// 1. Exporteur HTTP asynchrone non-bloquant
const exporter = new HttpTelemetryExporter({
  apiKey: "ag_live_xxxxxxxxxxxx",
  endpoint: "https://api.avantgate.cloud/api/v1/ingest/events",
  agentName: "prospect-qualifier",
  batchIntervalMs: 5000,
});

// 2. Adaptateur hybride : persistance locale SQLite + miroir Cloud temps réel
const storage = new PlatformStorageAdapter({
  primaryStorage: new SQLiteStorageAdapter(new Database("agent.db")),
  exporter,
});

// 3. StepRunner durable prêt pour l'observabilité SaaS
const runner = createStepRunner({
  workflowId: "wf-prospect-101",
  runId: "run-prospect-101",
  storage,
});
```

### 5.2. Endpoint d'ingestion des événements
- **URL** : `POST /api/v1/ingest/events`
- **Authentification** : `Authorization: Bearer ag_live_xxxxxxxxxxxx`
- **Fréquence** : Envoi groupé (*batching*) toutes les 5 secondes ou à la fin d'un `run`.

#### Format du Payload JSON (100% conforme à `TelemetryIngestPayload`) :
```json
{
  "runId": "run_98234afb-1234",
  "agentName": "prospect-qualifier",
  "timestamp": "2026-09-13T13:40:00.000Z",
  "events": [
    {
      "type": "STEP_START",
      "stepName": "fetch-prospect-data",
      "timestamp": "2026-09-13T13:40:01.000Z"
    },
    {
      "type": "TOOL_EXECUTION",
      "toolId": "crm_lookup_01",
      "toolName": "searchCRM",
      "aliasUsed": "lookup_crm",
      "parentToolId": null,
      "depth": 1,
      "durationMs": 340,
      "success": true,
      "llmSummary": { "found": true, "leadScore": 85 },
      "piiFilteredCount": 3,
      "tokens": {
        "promptTokens": 120,
        "completionTokens": 60,
        "totalTokens": 180
      },
      "costUsd": 0.00008,
      "cached": false,
      "timestamp": "2026-09-13T13:40:01.340Z"
    },
    {
      "type": "STEP_COMPLETED",
      "stepName": "fetch-prospect-data",
      "durationMs": 420,
      "piiDetectedCount": 3,
      "resultSummary": { "success": true },
      "timestamp": "2026-09-13T13:40:01.420Z"
    },
    {
      "type": "STEP_APPROVAL_REQUEST",
      "stepName": "send-outreach-email",
      "actionType": "SEND_EMAIL",
      "payloadSummary": { "recipientDomain": "acme.com", "template": "intro_sales" },
      "timestamp": "2026-09-13T13:40:02.000Z"
    }
  ],
  "usage": {
    "model": "gpt-4o-mini",
    "promptTokens": 1250,
    "completionTokens": 320,
    "totalTokens": 1570,
    "costUsd": 0.0003795
  }
}
```

---

## 💡 6. Les Pépites Cherry-Pickées (Helicone & AgentOps)

### 6.1. FinOps Cost Engine (`cost-calculator.ts` - Helicone Apache 2.0)
Calcul précis du coût par run et par modèle pour facturer les clients au centime près.

### 6.2. Infinite Loop Shield (`loop-shield.ts` - AgentOps MIT)
Disjoncteur automatique coupant les agents qui répètent 3 fois consécutives le même appel d'outil identique.

### 6.3. Semantic Tool Cache (`tool-cache.ts` - Helicone Apache 2.0)
Évite de payer deux fois l'API d'enrichissement de données si le même prospect a déjà été traité.

### 6.4. Dual-Channel PII Auditor (`pii-auditor.ts` - avantGate Propriétaire)
Enregistrement des preuves d'étanchéité RGPD : preuve que le résumé envoyé au LLM ne contenait aucune PII.

---

## 🎨 7. Les 5 Vues de la Console Frontend (Next.js 15)

1. **`/dashboard` (FinOps & Métriques globales)** : Coût cumulé ($), jetons consommés, latence médiane, ventilation par modèle de LLM.
2. **`/sessions/[id]` (Session Replay & Timeline Graph)** : Magnétoscope pas-à-pas affichant chaque réflexion, appel d'outil et réponse de l'agent.
3. **`/tools` (Santé & Fiabilité des Outils)** : Taux de succès, latence P50/P95, alertes de boucles folles détectées.
4. **`/security` (Dual-Channel PII Inspector)** : Inspecteur côte à côte (Vue LLM filtrée vs Vue brute sécurisée) et journal d'audit RGPD.
5. **`/approvals` (Human-in-the-Loop Inbox)** : Boîte de réception temps réel (SSE) permettant de valider ou rejeter en un clic les étapes suspendues (`step.waitForApproval()`).

---

## 💰 8. Modèle de Tarification & Plans SaaS

| Plan | Prix | Quotas & Fonctionnalités |
|---|---|---|
| **Free (Open-Source)** | 0€ | SDK `avantgate` local ($0 infra, sans dashboard cloud). |
| **Starter** | 29€ / mois | 50 000 événements/mois, Dashboard FinOps, 7 jours de rétention de Session Replay, Alertes budget email. |
| **Pro** | 99€ / mois | 500 000 événements/mois, Infinite Loop Shield, Dual-Channel PII Inspector, Inbox Human-in-the-loop, Alertes Slack. |
| **Enterprise** | Sur devis | Événements illimités, Déploiement Self-Hosted (VPC), Audit Logs immuables HIPAA/RGPD, SLA 99.9%. |

---

## 📜 9. Historique / History

| Date & Heure | Ancien Statut | Nouveau Statut | Auteur | Commentaire / Note |
|---|---|---|---|---|
| 2026-09-13 13:05 | - | TODO | Antigravity | Création de la spécification technique et architecture de la plateforme d'observabilité avantGate |
| 2026-09-13 13:25 | TODO | TODO | Antigravity | Intégration des fonctionnalités inspirées d'Helicone (FinOps) et d'AgentOps (Session Replay, Loop Shield) |
| 2026-09-13 13:28 | TODO | TODO | Antigravity | Ajout de la section détaillée Cherry-Picking avec 9 modules $0 infra isolés |
| 2026-09-13 13:42 | TODO | TODO | Antigravity | Intégration complète du Blueprint SaaS pour le dépôt privé `avantgate-platform` (Monorepo, Bootstrap, Schéma DB, Protocole d'ingestion, Pricing) |
| 2026-09-13 14:15 | TODO | TODO | Antigravity | Revue d'alignement avec FEAT-007 et création du ticket FEAT-008 (Pont de Télémétrie HTTP et harmonisation des données) |
| 2026-09-13 14:40 | TODO | APPROVED | Antigravity | Validation et mise à jour du ticket suite à la livraison complète de FEAT-007 et FEAT-008 dans le SDK avantGate |
