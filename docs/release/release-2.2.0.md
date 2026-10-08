# 🚀 AvantGate v2.2.0 — Release Notes

> **Release Date**: October 8, 2026  
> **NPM Package**: [`avantgate@2.2.0`](https://www.npmjs.com/package/avantgate)  
> **Release Type**: Feature & Architecture Release — In-Flight Custom Redaction Terms (`sanitizeCustomTerms`), Category-Based Masking, Interactive GateWall DLP Cockpit Manager (`CustomTermsManager`), and Hexagonal Database Ports & Adapters Storage Architecture (`StoragePort`, SQLite, In-Memory & PostgreSQL/Prisma Drivers).

---

## 📌 Executive Summary

As AI agents and copilots handle increasingly sensitive internal company operations, security teams face two major operational challenges:

1. **Proprietary & NDA Data Leaks Beyond Standard PII**: Standard regex scanners detect generic PII (emails, phone numbers, IBANs, credit cards, SSNs). However, the most damaging enterprise data leaks involve **proprietary project code names** (e.g., *"Project Apollo"*, *"Stargate"*), **client & partner enterprise names** under NDA (*"Acme Corp"*, *"Banque Populaire"*), **internal hostnames & infrastructure identities** (*"vault-prod.internal"*), and custom business secrets.
2. **Database Coupling & Multi-Instance Cloud Scalability**: The GateWall visual control plane (`gatewall/`) previously coupled services directly to a local, synchronous SQLite file driver (`sqlite-driver.ts`). While optimal for local-first zero-infrastructure development, enterprise deployments on cloud platforms (Kubernetes, AWS ECS, Vercel Serverless) require multi-instance database engines like **PostgreSQL** (via Prisma or Drizzle) alongside zero-disk in-memory drivers for fast CI testing.

**AvantGate v2.2.0 delivers a double breakthrough**:
- **Enterprise Custom Redaction Engine**: Zero-dependency, regex-safe, word-boundary in-flight sanitizer (`sanitizeCustomTerms`) integrated bidirectionally into both SDK ingress/egress firewalls and the GateWall interactive Cockpit UI.
- **Hexagonal Storage Architecture (Ports & Adapters)**: Clean decoupling of GateWall domain services via `StoragePort`, providing native zero-dependency SQLite by default, an ultra-fast In-Memory adapter for testing, and a production-ready PostgreSQL/Prisma adapter.

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              AVANTGATE v2.2.0 ARCHITECTURE                             │
│                                                                                        │
│  1. In-Flight Custom DLP Layer (avantgate)                                             │
│     • sanitizeCustomTerms(text, terms) with word-boundary isolation (\b)               │
│     • Subword Collision Shield: "Art" preserved in "partout" and "carte"               │
│     • Categorized Masks: [REDACTED_PROJECT], [REDACTED_COMPANY], [REDACTED_INFRA]      │
│     • Bidirectional Guards: Ingress prompts & Egress LLM completions                   │
│                                                                                        │
│  2. Interactive GateWall Cockpit (gatewall/)                                           │
│     • CustomTermsManager.tsx: Category badges, instant mask suggestions, 1-click delete │
│     • REST Endpoints: /api/v1/security/custom-terms (GET, POST, DELETE) with Zod       │
│                                                                                        │
│  3. Hexagonal Storage Engine (gatewall/lib/storage/)                                   │
│     • Core Domain Port: StoragePort (Sessions, Approvals, Pricing, Custom Terms)        │
│     • Default Adapter: SqliteStorageAdapter (Zero-dep Node 22 + JSON fallback)         │
│     • Testing Adapter: MemoryStorageAdapter (Zero-disk, ephemeral Map store)           │
│     • Enterprise Adapter: PrismaStorageAdapter (PostgreSQL / Supabase / RDS Ready)     │
│     • Dynamic Factory: getStorageAdapter() driven by STORAGE_DRIVER env variable       │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🌟 Key Highlights of v2.2.0

### 1. 🔏 Custom Redaction Terms Engine (`sanitizeCustomTerms`) ([FEAT-022](../../tickets/FEAT/FEAT-022-custom-redaction-terms-and-gatewall-manager.md))

The Core SDK now includes a zero-dependency, algorithmically hardened sanitizer designed to eliminate false positives and regex collisions:

- **Strict Word-Boundary Matching (`\b`)**: Prevents subword corruption. Sanitizing the protected term `"Art"` preserves regular French and English words such as `"partout"` and `"carte"`. Non-alphanumeric boundaries (e.g. `C++`, `[V2]`) automatically adapt to preserve character boundaries.
- **Automatic Regex Metacharacter Escaping**: Terms containing `+`, `*`, `?`, `[`, `]`, `(`, `)`, `{`, `}`, `.`, or `^` are safely neutralized before compilation into regular expressions.
- **Descending Length Ordering**: Terms are automatically sorted by string length (`b.term.length - a.term.length`), guaranteeing that composite phrases (e.g., *"Projet Apollo 11"*) match and mask before sub-phrases (*"Projet Apollo"*).
- **Category-Aware Default Masks**:
  - `PROJECT`: `[REDACTED_PROJECT]`
  - `COMPANY`: `[REDACTED_COMPANY]`
  - `INFRA`: `[REDACTED_INFRA]`
  - `CUSTOM`: `[REDACTED_CUSTOM]`
- **Bidirectional In-Process Enforcement**:
  - Ingress: Evaluated in `applySecurityGuards()` before prompts reach LLM providers.
  - Egress: Evaluated in `applyOutputGuards()` (`src/secret-guard.ts`) and `applyOutputSecurityGuards()` to guarantee that secrets leaked from RAG contexts or completions never reach client outputs or audit logs.

#### SDK Usage Example:
```typescript
import { AvantGateControlLayer } from "avantgate";

const gate = new AvantGateControlLayer({
  security: {
    enablePIIRedaction: true,
    customRedactionTerms: [
      {
        term: "Project Apollo",
        category: "PROJECT",
        mask: "[REDACTED_PROJECT]",
      },
      {
        term: "vault-prod.internal",
        category: "INFRA",
      },
      {
        term: "Acme Corp",
        category: "COMPANY",
      },
    ],
  },
});

// Prompt input:
// "Deploying to vault-prod.internal for Project Apollo with Acme Corp"
//
// Sanitized egress:
// "Deploying to [REDACTED_INFRA] for [REDACTED_PROJECT] with [REDACTED_COMPANY]"
```

---

### 2. 🖥️ Interactive GateWall Cockpit Terms Manager (`CustomTermsManager.tsx`)

Administrators and security engineers can now inspect and manage proprietary sensitive terms visually directly from GateWall Cockpit:

- **Interactive UI Panel**: Embedded in the Security Cockpit view (`gatewall/features/security/SecurityView.tsx`).
- **Category Badges**: Color-coded badges for *Project* (Purple), *Company* (Blue), *Infra* (Amber), and *Custom* (Emerald).
- **Auto-Mask Suggestion**: Suggests canonical masks dynamically as categories are selected.
- **REST API Endpoints**:
  - `GET /api/v1/security/custom-terms`: Returns active protected terms.
  - `POST /api/v1/security/custom-terms`: Adds terms with strict Zod validation.
  - `DELETE /api/v1/security/custom-terms?id=...`: Deletes terms with immediate reactive cache invalidation.
- **TanStack Query Integration**: Handled via `useCustomTerms()` hook with automatic query key invalidation (`queryKeys.customTerms`).

---

### 3. 🔌 Hexagonal Database Storage Architecture (`StoragePort`) ([FEAT-032](../../tickets/FEAT/FEAT-032-hexagonal-storage-port-and-adapter.md))

GateWall transitions from a hard-coded SQLite implementation to an **Interface First** Hexagonal Architecture (Ports & Adapters):

#### The Unified Core Port (`gatewall/lib/storage/ports/storage.port.ts`)
```typescript
export interface StoragePort {
  // Telemetry & Sessions
  loadSessions(): Promise<SessionRun[]>;
  persistSession(session: SessionRun): Promise<void>;

  // Human-in-the-Loop Approvals
  loadApprovals(): Promise<ApprovalItem[]>;
  persistApproval(approval: ApprovalItem): Promise<void>;

  // FinOps Model Pricing
  loadPricing(): Promise<ModelPricingItem[]>;
  persistPrice(pricing: ModelPricingItem): Promise<void>;
  deletePrice(provider: string, model: string): Promise<boolean>;
  seedPricing(force?: boolean): Promise<void>;

  // DLP Custom Terms
  loadCustomTerms(): Promise<CustomTermItem[]>;
  persistCustomTerm(term: CustomTermItem): Promise<void>;
  deleteCustomTerm(id: string): Promise<boolean>;
}
```

#### Pluggable Infrastructure Adapters:
1. **`SqliteStorageAdapter` (`adapters/sqlite.adapter.ts`)**:
   - Zero external npm dependencies using Node.js 22 built-in `node:sqlite` (`DatabaseSync`) and JSON fallback.
   - Preserves 100% backward compatibility for single-instance, local-first Docker, Bun, and Node deployments.
2. **`MemoryStorageAdapter` (`adapters/memory.adapter.ts`)**:
   - In-memory `Map`-backed adapter.
   - Executes unit tests and ephemeral runs in milliseconds without creating files on disk (`data/gatewall.db`).
3. **`PrismaStorageAdapter` (`adapters/prisma.adapter.ts`)**:
   - Enterprise-ready adapter for PostgreSQL, Supabase, Neon, or AWS RDS.
   - Enables horizontal scaling across Kubernetes clusters and serverless environments.
4. **`StorageFactory` (`storage-factory.ts`)**:
   - Transparently selects the active driver via `process.env.STORAGE_DRIVER`:
     - `STORAGE_DRIVER=memory` ➔ `MemoryStorageAdapter`
     - `STORAGE_DRIVER=sqlite` (default) ➔ `SqliteStorageAdapter`
     - `STORAGE_DRIVER=prisma` ➔ `PrismaStorageAdapter`

---

## 📊 Summary of Changes & File Impacts

| Subsystem | File | Impact / Description |
|---|---|---|
| **Core SDK** | `src/types.ts` | Added `TermCategory`, `CustomRedactionTermDef`, and `customRedactionTerms` to `SecurityConfig`. |
| **Core SDK** | `src/custom-terms.ts` | Core zero-dependency regex sanitizer with subword collision protection and descending length sorting. |
| **Core SDK** | `src/secret-guard.ts` | Integrated `sanitizeCustomTerms` into output DLP and secret scanning pipeline. |
| **Core SDK** | `src/control-layer.ts` | Integrated bidirectional custom term masking in ingress `applySecurityGuards` and egress `applyOutputSecurityGuards`. |
| **Core SDK** | `src/index.ts` | Exported `sanitizeCustomTerms`, `CustomRedactionTermDef`, and `TermCategory`. |
| **GateWall** | `gatewall/lib/storage/ports/storage.port.ts` | Pure `StoragePort` interface defining storage contracts. |
| **GateWall** | `gatewall/lib/storage/adapters/sqlite.adapter.ts` | SQLite implementation of `StoragePort`. |
| **GateWall** | `gatewall/lib/storage/adapters/memory.adapter.ts` | In-memory implementation of `StoragePort` for tests and ephemeral runs. |
| **GateWall** | `gatewall/lib/storage/adapters/prisma.adapter.ts` | PostgreSQL/Prisma adapter template for enterprise scaling. |
| **GateWall** | `gatewall/lib/storage/storage-factory.ts` | Dynamic adapter factory selecting storage engine via `process.env.STORAGE_DRIVER`. |
| **GateWall** | `gatewall/lib/storage/telemetry-store.ts` | Decoupled `TelemetryStore` to consume `StoragePort` via dependency injection. |
| **GateWall** | `gatewall/app/api/v1/security/custom-terms/route.ts` | REST API for custom terms using `StoragePort` with Zod validation. |
| **GateWall** | `gatewall/app/api/v1/pricing/route.ts` | Decoupled pricing route to consume `StoragePort`. |
| **GateWall UI**| `gatewall/features/security/CustomTermsManager.tsx` | Interactive cockpit manager with category badges and live sync. |
| **GateWall UI**| `gatewall/features/security/SecurityView.tsx` | Integrated `CustomTermsManager` into GateWall Cockpit Security dashboard. |
| **GateWall UI**| `gatewall/hooks/useCustomTerms.ts` | TanStack Query hook managing terms cache and mutations. |
| **Tests** | `tests/custom-terms-redaction.test.ts` | Unit tests for word boundary regex, category masks, and collision safety. |
| **Tests** | `gatewall/tests/custom-terms-storage.test.ts` | Unit tests for custom terms persistence and deletion. |
| **Tests** | `gatewall/tests/storage-port-adapters.test.ts` | Comprehensive unit tests for Memory, SQLite, and Prisma storage adapters. |

---

## 🧪 Verification & Test Coverage

All test suites and production builds pass with zero warnings:

- **SDK Core Tests (`npm test`)**:
  - Ingress and egress custom terms redaction verified.
  - Word boundary isolation, special character escaping, and descending length precedence validated.
  - All existing workflow, saga rollback, client, and UI canvas tests pass 100%.
- **GateWall Test Suite (`npm test --prefix gatewall`)**:
  - **30 tests across 9 suites pass 100%**.
  - `storage-port-adapters.test.ts`: Memory, SQLite, Prisma mock, and Factory resolution validated.
- **Production Builds**:
  - Root: `tsup` + `tsc` declarations emitted in < 100ms.
  - GateWall: Next.js 16.3.5 Turbopack production build compiled with strict TypeScript validation.

---

## 📦 Upgrade Guide (v2.1.0 ➔ v2.2.0)

Upgrading to **v2.2.0** is **100% backward-compatible**. No existing APIs or database schemas were broken:

1. Update package in `package.json`:
   ```bash
   npm install avantgate@2.2.0
   ```
2. *(Optional)* Add custom redaction terms to your existing `AvantGateControlLayer` security configuration:
   ```typescript
   const gate = new AvantGateControlLayer({
     security: {
       customRedactionTerms: [
         { term: "Project Falcon", category: "PROJECT" },
         { term: "Acme Corp", category: "COMPANY" },
       ],
     },
   });
   ```
3. *(Optional)* In GateWall, run tests in-memory without disk writes:
   ```bash
   STORAGE_DRIVER=memory npm test
   ```
