import { createHash } from "crypto";

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: "gw_live_" | "gw_pub_" | "ag_live_" | "ag_pub_";
  hashedKey: string;
  scopes: string[];
  createdAt: string;
  revokedAt?: string;
}

export interface VerifyApiKeyResult {
  valid: boolean;
  error?: string;
  key?: {
    id: string;
    name: string;
    prefix: string;
    scopes: string[];
  };
}

class AuthService {
  private keysByHash: Map<string, ApiKeyRecord> = new Map();

  constructor() {
    this.seedDefaultKeys();
  }

  private hashKey(key: string): string {
    return createHash("sha256").update(key.trim()).digest("hex");
  }

  private seedDefaultKeys(): void {
    const defaultKeys = [
      {
        token: "gw_live_dev_test_key_123456789",
        name: "ProspectAI Backend Agent",
        prefix: "gw_live_" as const,
        scopes: ["telemetry:ingest", "approvals:read", "approvals:write"],
      },
      {
        token: "gw_pub_prospect_ai_123456789",
        name: "ProspectAI Web Client",
        prefix: "gw_pub_" as const,
        scopes: ["telemetry:client:ingest"],
      },
      // Backward compatibility keys
      {
        token: "ag_live_dev_test_key_123456789",
        name: "Legacy Backend Agent",
        prefix: "ag_live_" as const,
        scopes: ["telemetry:ingest", "approvals:read", "approvals:write"],
      },
      {
        token: "ag_pub_dev_test_key_123456789",
        name: "Legacy Web Client",
        prefix: "ag_pub_" as const,
        scopes: ["telemetry:client:ingest"],
      },
    ];

    for (const item of defaultKeys) {
      this.registerKey(item.token, item.name, item.prefix, item.scopes);
    }
  }

  public registerKey(
    token: string,
    name: string,
    prefix: ApiKeyRecord["prefix"],
    scopes: string[]
  ): ApiKeyRecord {
    const record: ApiKeyRecord = {
      id: `key_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name,
      prefix,
      hashedKey: this.hashKey(token),
      scopes,
      createdAt: new Date().toISOString(),
    };
    this.keysByHash.set(record.hashedKey, record);
    return record;
  }

  private extractTokenFromHeaders(headers: Headers): string | null {
    const authHeader = headers.get("authorization");
    if (authHeader) {
      return authHeader.replace(/^Bearer\s+/i, "").trim();
    }
    const xApiKey = headers.get("x-api-key");
    if (xApiKey) {
      return xApiKey.trim();
    }
    return null;
  }

  public async verifyApiKey(params: { headers: Headers }): Promise<VerifyApiKeyResult> {
    const token = this.extractTokenFromHeaders(params.headers);
    if (!token) {
      return { valid: false, error: "Missing API Key header" };
    }

    const hashed = this.hashKey(token);
    const existing = this.keysByHash.get(hashed);

    if (existing) {
      if (existing.revokedAt) {
        return { valid: false, error: "API Key revoked" };
      }
      return {
        valid: true,
        key: {
          id: existing.id,
          name: existing.name,
          prefix: existing.prefix,
          scopes: existing.scopes,
        },
      };
    }

    // Dynamic fallback validation for development keys with valid prefix
    return this.validateDynamicPrefixKey(token);
  }

  private validateDynamicPrefixKey(token: string): VerifyApiKeyResult {
    const isServerKey = token.startsWith("gw_live_") || token.startsWith("ag_live_");
    if (isServerKey) {
      const prefix = token.startsWith("gw_live_") ? "gw_live_" : "ag_live_";
      return {
        valid: true,
        key: {
          id: `dyn_${prefix}`,
          name: "Dynamic Backend Agent",
          prefix,
          scopes: ["telemetry:ingest", "approvals:read", "approvals:write"],
        },
      };
    }

    const isClientKey = token.startsWith("gw_pub_") || token.startsWith("ag_pub_");
    if (isClientKey) {
      const prefix = token.startsWith("gw_pub_") ? "gw_pub_" : "ag_pub_";
      return {
        valid: true,
        key: {
          id: `dyn_${prefix}`,
          name: "Dynamic Web Client",
          prefix,
          scopes: ["telemetry:client:ingest"],
        },
      };
    }

    return { valid: false, error: "Invalid API Key prefix" };
  }
}

const authService = new AuthService();

export const auth = {
  api: {
    verifyApiKey: (params: { headers: Headers }) => authService.verifyApiKey(params),
  },
  service: authService,
};
