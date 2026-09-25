import fs from "fs";
import path from "path";
import type { ModelPrice, PricingAdapter } from "./types";
import { ConfigurationError } from "./types";
import { SEED_MODEL_PRICES } from "./pricing";

export interface SqliteDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
  close?(): void;
}

export interface SqlitePricingAdapterOptions {
  /**
   * Chemin vers le fichier SQLite local (par exemple "./data/gatewall.db" ou "./data/pricing.db").
   * Utilisez ":memory:" pour une base volatile en mémoire.
   */
  dbPath?: string;
  /**
   * Instance personnalisée compatible SQLite (DatabaseSync de node:sqlite ou better-sqlite3).
   */
  db?: SqliteDatabaseLike;
  /**
   * Nom de la table de tarification (défaut : "model_pricing").
   */
  tableName?: string;
  /**
   * Si true, injecte automatiquement SEED_MODEL_PRICES si la table est vide lors de l'initialisation.
   */
  autoSeed?: boolean;
}

export interface StoredModelPriceRow {
  provider: string;
  model: string;
  prompt_usd_per_million: number;
  completion_usd_per_million: number;
  cache_hit_usd_per_million: number | null;
  is_active: number;
  updated_at: string;
}

export interface ModelPricingRecord {
  provider: string;
  model: string;
  price: ModelPrice;
  isActive: boolean;
  updatedAt: string;
}

const normalizeIdentifier = (val: string): string => {
  return val.trim().toLowerCase().replace(":", "/");
};

/**
 * Adaptateur de tarification SQLite Zero-Infrastructure pour avantGate.
 * Implémente le port PricingAdapter avec persistance locale et support hot-reload.
 */
export class SqlitePricingAdapter implements PricingAdapter {
  private db: SqliteDatabaseLike;
  private tableName: string;

  constructor(options: SqlitePricingAdapterOptions = {}) {
    this.tableName = options.tableName ?? "model_pricing";
    this.db = options.db ?? this.initDatabase(options.dbPath ?? ":memory:");
    this.initSchema();

    if (options.autoSeed) {
      this.seedDefaultPrices(false);
    }
  }

  private initDatabase = (dbPath: string): SqliteDatabaseLike => {
    if (dbPath !== ":memory:") {
      const dir = path.dirname(path.resolve(dbPath));
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    try {
      // Chargement natif sans dépendance externe (Node.js 22+)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { DatabaseSync } = require("node:sqlite");
      return new DatabaseSync(dbPath) as SqliteDatabaseLike;
    } catch (err) {
      throw new ConfigurationError(
        `[avantGate] Failed to initialize native SQLite at '${dbPath}'. ` +
        `Ensure you are running on Node.js 22+ or provide a custom 'db' instance in options. Error: ${String(err)}`
      );
    }
  };

  private initSchema = (): void => {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_usd_per_million REAL NOT NULL,
        completion_usd_per_million REAL NOT NULL,
        cache_hit_usd_per_million REAL,
        is_active INTEGER DEFAULT 1,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider, model)
      );
      CREATE INDEX IF NOT EXISTS idx_${this.tableName}_lookup 
      ON ${this.tableName}(provider, model, is_active);
    `);
  };

  /**
   * Implémentation du port avantGate PricingAdapter.
   * Résolution hiérarchique : (provider, model) -> (provider/model) -> (model).
   */
  fetchPrice = (model: string, provider?: string): ModelPrice | undefined => {
    const normModel = normalizeIdentifier(model);
    const normProvider = provider ? normalizeIdentifier(provider) : undefined;

    // 1. Recherche par (provider, model) si provider fourni
    if (normProvider) {
      const row = this.queryActiveRow(normProvider, normModel);
      if (row) return this.mapRowToPrice(row);
    }

    // 2. Si model contient "provider/model" (ex: "openrouter/deepseek/deepseek-chat")
    if (normModel.includes("/")) {
      const firstSlashIdx = normModel.indexOf("/");
      const extractedProvider = normModel.slice(0, firstSlashIdx);
      const extractedModel = normModel.slice(firstSlashIdx + 1);

      const splitRow = this.queryActiveRow(extractedProvider, extractedModel);
      if (splitRow) return this.mapRowToPrice(splitRow);
    }

    // 3. Repli : recherche par model seul (quel que soit le provider ou provider vide)
    const directRow = this.queryByModelOnly(normModel);
    if (directRow) return this.mapRowToPrice(directRow);

    return undefined;
  };

  private queryActiveRow = (provider: string, model: string): StoredModelPriceRow | undefined => {
    const stmt = this.db.prepare(`
      SELECT provider, model, prompt_usd_per_million, completion_usd_per_million, cache_hit_usd_per_million, is_active, updated_at
      FROM ${this.tableName}
      WHERE provider = ? AND model = ? AND is_active = 1
      LIMIT 1
    `);
    return stmt.get(provider, model) as StoredModelPriceRow | undefined;
  };

  private queryByModelOnly = (model: string): StoredModelPriceRow | undefined => {
    const stmt = this.db.prepare(`
      SELECT provider, model, prompt_usd_per_million, completion_usd_per_million, cache_hit_usd_per_million, is_active, updated_at
      FROM ${this.tableName}
      WHERE model = ? AND is_active = 1
      LIMIT 1
    `);
    return stmt.get(model) as StoredModelPriceRow | undefined;
  };

  private mapRowToPrice = (row: StoredModelPriceRow): ModelPrice => {
    return {
      promptUSDPerMillion: Number(row.prompt_usd_per_million),
      completionUSDPerMillion: Number(row.completion_usd_per_million),
      cacheHitUSDPerMillion: row.cache_hit_usd_per_million != null
        ? Number(row.cache_hit_usd_per_million)
        : undefined,
    };
  };

  /**
   * Enregistre ou met à jour la tarification d'un modèle.
   */
  upsertPrice = (provider: string, model: string, price: ModelPrice, isActive: boolean = true): void => {
    const normProvider = normalizeIdentifier(provider);
    const normModel = normalizeIdentifier(model);
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO ${this.tableName}
      (provider, model, prompt_usd_per_million, completion_usd_per_million, cache_hit_usd_per_million, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      normProvider,
      normModel,
      price.promptUSDPerMillion,
      price.completionUSDPerMillion,
      price.cacheHitUSDPerMillion ?? null,
      isActive ? 1 : 0,
      now
    );
  };

  /**
   * Supprime une règle tarifaire de la base de données.
   */
  deletePrice = (provider: string, model: string): boolean => {
    const normProvider = normalizeIdentifier(provider);
    const normModel = normalizeIdentifier(model);

    const stmt = this.db.prepare(`
      DELETE FROM ${this.tableName}
      WHERE provider = ? AND model = ?
    `);
    const result = stmt.run(normProvider, normModel) as { changes?: number };
    return Boolean(result && typeof result.changes === "number" && result.changes > 0);
  };

  /**
   * Retourne l'ensemble des règles tarifaires enregistrées.
   */
  getAllPrices = (): ModelPricingRecord[] => {
    const stmt = this.db.prepare(`
      SELECT provider, model, prompt_usd_per_million, completion_usd_per_million, cache_hit_usd_per_million, is_active, updated_at
      FROM ${this.tableName}
      ORDER BY provider ASC, model ASC
    `);

    const rows = stmt.all() as StoredModelPriceRow[];
    return rows.map((row) => ({
      provider: row.provider,
      model: row.model,
      price: this.mapRowToPrice(row),
      isActive: Boolean(row.is_active),
      updatedAt: row.updated_at,
    }));
  };

  /**
   * Remplit la base avec le catalogue de départ SEED_MODEL_PRICES.
   * @param force Si true, écrase les tarifs existants. Si false, insère uniquement les modèles manquants.
   * @returns Le nombre d'enregistrements insérés.
   */
  seedDefaultPrices = (force: boolean = false): number => {
    const conflictClause = force ? "INSERT OR REPLACE" : "INSERT OR IGNORE";
    const stmt = this.db.prepare(`
      ${conflictClause} INTO ${this.tableName}
      (provider, model, prompt_usd_per_million, completion_usd_per_million, cache_hit_usd_per_million, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let inserted = 0;
    const now = new Date().toISOString();

    for (const [key, price] of Object.entries(SEED_MODEL_PRICES)) {
      const normKey = normalizeIdentifier(key);
      let provider = "direct";
      let model = normKey;

      if (normKey.includes("/")) {
        const slashIdx = normKey.indexOf("/");
        provider = normKey.slice(0, slashIdx);
        model = normKey.slice(slashIdx + 1);
      }

      const res1 = stmt.run(
        provider,
        model,
        price.promptUSDPerMillion,
        price.completionUSDPerMillion,
        price.cacheHitUSDPerMillion ?? null,
        1,
        now
      ) as { changes?: number };
      if (res1?.changes && res1.changes > 0) inserted++;

      if (provider !== "direct") {
        const res2 = stmt.run(
          "direct",
          normKey,
          price.promptUSDPerMillion,
          price.completionUSDPerMillion,
          price.cacheHitUSDPerMillion ?? null,
          1,
          now
        ) as { changes?: number };
        if (res2?.changes && res2.changes > 0) inserted++;
      }
    }

    return inserted;
  };

  /**
   * Ferme la connexion SQLite sous-jacente si supporté.
   */
  close = (): void => {
    if (typeof this.db.close === "function") {
      this.db.close();
    }
  };
}
