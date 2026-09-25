import { describe, it } from "node:test";
import assert from "node:assert";
import {
  sanitizeSecrets,
  applyOutputGuards,
  SecretLeakBlockedError,
  AvantGateControlLayer,
  LLMProviderPort,
} from "../src/index";

describe("🔒 Output DLP & Secret Leak Guard (FEAT-021)", () => {
  describe("1. sanitizeSecrets unit tests", () => {
    it("redacts OpenAI API keys", () => {
      const input = "Here is your key: sk-proj-1234567890abcdefghijklmnopqrstuvwxyzAB and enjoy.";
      const res = sanitizeSecrets(input);
      assert.strictEqual(res.hasSecrets, true);
      assert.strictEqual(res.detections.length, 1);
      assert.strictEqual(res.detections[0].type, "OPENAI_API_KEY");
      assert.ok(res.text.includes("[REDACTED_OPENAI_KEY]"));
      assert.ok(!res.text.includes("sk-proj-"));
    });

    it("redacts Anthropic API keys", () => {
      const input = "Connecting with sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234567890 securely.";
      const res = sanitizeSecrets(input);
      assert.strictEqual(res.hasSecrets, true);
      assert.strictEqual(res.detections[0].type, "ANTHROPIC_API_KEY");
      assert.ok(res.text.includes("[REDACTED_ANTHROPIC_KEY]"));
    });

    it("redacts AWS Access Keys", () => {
      const input = "Backup dispatched to AWS with credentials AKIAIOSFODNN7EXAMPLE and secret.";
      const res = sanitizeSecrets(input);
      assert.strictEqual(res.hasSecrets, true);
      assert.strictEqual(res.detections[0].type, "AWS_ACCESS_KEY");
      assert.ok(res.text.includes("[REDACTED_AWS_KEY]"));
      assert.ok(!res.text.includes("AKIAIOSFODNN7EXAMPLE"));
    });

    it("redacts GitHub personal access tokens", () => {
      const input = "Clone repo via token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890.";
      const res = sanitizeSecrets(input);
      assert.strictEqual(res.hasSecrets, true);
      assert.strictEqual(res.detections[0].type, "GITHUB_TOKEN");
      assert.ok(res.text.includes("[REDACTED_GITHUB_TOKEN]"));
    });

    it("redacts JWT tokens", () => {
      const fakeJwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
      const input = `User session verified: ${fakeJwt}`;
      const res = sanitizeSecrets(input);
      assert.strictEqual(res.hasSecrets, true);
      assert.strictEqual(res.detections[0].type, "JWT_TOKEN");
      assert.ok(res.text.includes("[REDACTED_JWT]"));
      assert.ok(!res.text.includes(fakeJwt));
    });

    it("redacts private keys (RSA / OpenSSH)", () => {
      const privateKey = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Y7...\n-----END RSA PRIVATE KEY-----";
      const input = `Server configuration:\n${privateKey}\nDone.`;
      const res = sanitizeSecrets(input);
      assert.strictEqual(res.hasSecrets, true);
      assert.strictEqual(res.detections[0].type, "PRIVATE_KEY");
      assert.ok(res.text.includes("[REDACTED_PRIVATE_KEY]"));
      assert.ok(!res.text.includes("MIIEowIBAAKCA"));
    });

    it("redacts database credentials in connection strings", () => {
      const input = "Connecting to database postgres://postgres_admin:secret_pass_123@db.internal:5432/production";
      const res = sanitizeSecrets(input);
      assert.strictEqual(res.hasSecrets, true);
      assert.strictEqual(res.detections[0].type, "DATABASE_CONNECTION_SECRET");
      assert.ok(res.text.includes("[REDACTED_DB_SECRET]"));
      assert.ok(!res.text.includes("secret_pass_123"));
    });
  });

  describe("2. applyOutputGuards options & modes", () => {
    it("redacts both PII and API keys in REDACT mode", () => {
      const raw = "Contact alice@example.com using key sk-proj-1234567890abcdefghijklmnopqrstuvwxyzAB for support.";
      const result = applyOutputGuards(raw, {
        maskPII: true,
        blockSecretLeaks: true,
        secretLeakAction: "REDACT",
      });

      assert.strictEqual(result.sanitized, true);
      assert.strictEqual(result.secretDetected, true);
      assert.strictEqual(result.piiMaskedCount, 1);
      assert.ok(result.text.includes("[REDACTED_EMAIL]"));
      assert.ok(result.text.includes("[REDACTED_OPENAI_KEY]"));
    });

    it("throws SecretLeakBlockedError in BLOCK mode when secret detected", () => {
      const raw = "Exfiltrated token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 in response.";
      assert.throws(
        () => {
          applyOutputGuards(raw, {
            maskPII: true,
            blockSecretLeaks: true,
            secretLeakAction: "BLOCK",
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof SecretLeakBlockedError);
          assert.strictEqual(err.detections[0].type, "GITHUB_TOKEN");
          return true;
        }
      );
    });
  });

  describe("3. AvantGateControlLayer integration", () => {
    it("automatically redacts secrets in LLM response text before returning to caller", async () => {
      const mockProvider: LLMProviderPort = {
        name: "mock-llm",
        complete: async () => ({
          text: "Here is your temporary server key: sk-proj-9876543210zyxwvutsrqponmlkjihgfedcBA and admin email admin@corp.com",
          usage: { promptTokens: 10, completionTokens: 25, totalTokens: 35 },
        }),
      };

      const firewall = new AvantGateControlLayer({
        primary: { provider: "custom", model: "mock-model" },
        security: {
          outputDLP: true,
          maskPII: true,
          blockSecretLeaks: true,
          secretLeakAction: "REDACT",
        },
      });

      const res = await firewall.execute({
        userQuery: "Show me the configuration credentials.",
        providerOverride: mockProvider,
      });

      assert.ok(!res.text.includes("sk-proj-"));
      assert.ok(res.text.includes("[REDACTED_OPENAI_KEY]"));
      assert.ok(!res.text.includes("admin@corp.com"));
      assert.ok(res.text.includes("[REDACTED_EMAIL]"));
    });

    it("blocks execution when secretLeakAction is BLOCK", async () => {
      const mockProvider: LLMProviderPort = {
        name: "mock-llm",
        complete: async () => ({
          text: "Critical leakage: AKIA1111222233334444 leaked by agent.",
          usage: { promptTokens: 10, completionTokens: 15, totalTokens: 25 },
        }),
      };

      const firewall = new AvantGateControlLayer({
        primary: { provider: "custom", model: "mock-model" },
        security: {
          blockSecretLeaks: true,
          secretLeakAction: "BLOCK",
        },
      });

      await assert.rejects(
        async () => {
          await firewall.execute({
            userQuery: "Generate config",
            providerOverride: mockProvider,
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof SecretLeakBlockedError);
          return true;
        }
      );
    });
  });
});
