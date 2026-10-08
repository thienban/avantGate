import assert from "node:assert";
import { sanitizeCustomTerms } from "../src/custom-terms";
import { AvantGateControlLayer } from "../src/control-layer";

console.log("🛡️ Testing avantGate Custom Redaction Terms (FEAT-022)...");

function testSubwordNonRegression(): void {
  const result = sanitizeCustomTerms("Nous vendons des cartes d'art partout dans le monde.", [
    { term: "Art", category: "CUSTOM" },
  ]);

  // "cartes" and "partout" must NOT be redacted, only standalone "art"
  assert.strictEqual(
    result.text,
    "Nous vendons des cartes d'[REDACTED_CUSTOM] partout dans le monde."
  );
  assert.strictEqual(result.maskedCount, 1);
  assert.deepStrictEqual(result.matchedTerms, ["Art"]);
  console.log("  ✅ Criteria 1: Subwords (carte, partout) preserved without false positive.");
}

function testSpecialCharactersAndRegexEscaping(): void {
  const result = sanitizeCustomTerms(
    "Architecture basée sur Projet C++ et App [V2] déployée sur db.internal.net.",
    [
      { term: "Projet C++", category: "PROJECT" },
      { term: "App [V2]", category: "CUSTOM" },
      { term: "db.internal.net", category: "INFRA" },
    ]
  );

  assert.strictEqual(
    result.text,
    "Architecture basée sur [REDACTED_PROJECT] et [REDACTED_CUSTOM] déployée sur [REDACTED_INFRA]."
  );
  assert.strictEqual(result.maskedCount, 3);
  console.log("  ✅ Criteria 2: Special regex characters (++, [], .) handled safely.");
}

function testCategoryDefaultMasks(): void {
  const result = sanitizeCustomTerms("Acme Corp travaille sur Manhattan dans vault-prod.", [
    { term: "Manhattan", category: "PROJECT" },
    { term: "Acme Corp", category: "COMPANY" },
    { term: "vault-prod", category: "INFRA" },
    { term: "inconnu", category: "CUSTOM" },
  ]);

  assert.strictEqual(
    result.text,
    "[REDACTED_COMPANY] travaille sur [REDACTED_PROJECT] dans [REDACTED_INFRA]."
  );
  assert.strictEqual(result.maskedCount, 3);
  console.log("  ✅ Category default masks ([REDACTED_PROJECT], [REDACTED_COMPANY], [REDACTED_INFRA]) validated.");
}

function testCaseSensitivityOptions(): void {
  // Case-insensitive by default
  const resInsensitive = sanitizeCustomTerms("Projet apollo et APOLLO sont identiques.", [
    { term: "Apollo", category: "PROJECT" },
  ]);
  assert.strictEqual(resInsensitive.text, "Projet [REDACTED_PROJECT] et [REDACTED_PROJECT] sont identiques.");
  assert.strictEqual(resInsensitive.maskedCount, 2);

  // Case-sensitive when specified
  const resSensitive = sanitizeCustomTerms("Projet Apollo et apollo sont distincts.", [
    { term: "Apollo", category: "PROJECT", caseSensitive: true },
  ]);
  assert.strictEqual(resSensitive.text, "Projet [REDACTED_PROJECT] et apollo sont distincts.");
  assert.strictEqual(resSensitive.maskedCount, 1);
  console.log("  ✅ Case sensitivity configuration validated.");
}

function testLongerTermPrecedence(): void {
  const result = sanitizeCustomTerms("Bienvenue sur Projet Apollo 11 pour la mission.", [
    { term: "Projet Apollo", category: "PROJECT" },
    { term: "Projet Apollo 11", category: "PROJECT", mask: "[REDACTED_APOLLO_11]" },
  ]);

  assert.strictEqual(result.text, "Bienvenue sur [REDACTED_APOLLO_11] pour la mission.");
  assert.strictEqual(result.maskedCount, 1);
  console.log("  ✅ Longer term precedence sorting validated.");
}

async function testControlLayerIngressAndEgressIntegration(): Promise<void> {
  const gate = new AvantGateControlLayer({
    primary: {
      provider: "openai",
      model: "gpt-4o-mini",
    },
    mockSimulation: true,
    security: {
      customRedactionTerms: [
        { term: "SecretProjectX", category: "PROJECT" },
        { term: "Globex Corporation", category: "COMPANY" },
      ],
    },
  });

  const execution = await gate.execute({
    userQuery: "Analyse le statut de SecretProjectX pour Globex Corporation.",
  });

  // Verify simulation output executed
  assert.ok(execution.text);
  assert.strictEqual(execution.attempts, 1);
  console.log("  ✅ AvantGateControlLayer Ingress & Egress integration validated.");
}

async function runAllTests(): Promise<void> {
  testSubwordNonRegression();
  testSpecialCharactersAndRegexEscaping();
  testCategoryDefaultMasks();
  testCaseSensitivityOptions();
  testLongerTermPrecedence();
  await testControlLayerIngressAndEgressIntegration();
  console.log("🎉 All FEAT-022 Core custom terms redaction tests passed!\n");
}

runAllTests().catch((err) => {
  console.error("❌ Test failure:", err);
  process.exit(1);
});
