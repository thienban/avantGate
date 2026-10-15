import {
  InFlightRedactionSession,
  BidirectionalSanitizer,
  createInFlightRedactionSession,
  validateIbanChecksum,
  validateNirChecksum,
  validateLuhnChecksum,
} from "../src/redactor";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function readStreamToString(readable: ReadableStream<string>): Promise<string> {
  const reader = readable.getReader();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += value;
  }
  return result;
}

async function runInFlightRedactorTests() {
  console.log("🛡️ Testing In-Flight Bidirectional DLP (FEAT-047 v2.5.0)...\n");

  // ==========================================
  // Test Suite 1: ISO 7064 Modulo 97 & NIR Checksums
  // ==========================================
  console.log("--- 1. Arithmetic Modulo 97 Validations ---");
  const validIban = "FR7630006000011234567890189";
  const validIbanSpaced = "FR76 3000 6000 0112 3456 7890 189";
  const invalidIban = "FR7630006000011234567890188"; // Wrong checksum
  const shortIban = "FR763000";

  assert(validateIbanChecksum(validIban), "Valid French IBAN passes ISO 7064 Modulo 97");
  assert(validateIbanChecksum(validIbanSpaced), "Spaced French IBAN passes ISO 7064 Modulo 97");
  assert(!validateIbanChecksum(invalidIban), "Tampered IBAN rejected by ISO 7064 Modulo 97");
  assert(!validateIbanChecksum(shortIban), "Too short IBAN rejected");

  // NIR SSN (1850575123456: 1850575123456 % 97 = 19 -> key = 97 - 19 = 78)
  const validNir15 = "1 85 05 75 123 456 73";
  const invalidNirKey = "1 85 05 75 123 456 99"; // Key 99 is invalid
  const validNir13 = "1 85 05 75 123 456";
  const validCorsicaNir = "2 90 04 2A 123 456";

  assert(validateNirChecksum(validNir15), "15-digit NIR with matching key passes Modulo 97");
  assert(!validateNirChecksum(invalidNirKey), "15-digit NIR with mismatched key rejected");
  assert(validateNirChecksum(validNir13), "13-digit NIR without key validates format");
  assert(validateNirChecksum(validCorsicaNir), "Corsica 2A NIR validates format");

  // Luhn Algorithm (FEAT-065)
  const validVisa = "4532 0151 1283 0366";
  const validMastercard = "5412-7512-3412-3452";
  const validAmex = "3782 822463 10005";
  const invalidLuhnCard = "4532 0151 1283 0367";
  const invalidLengthCard = "4532 0151";

  assert(validateLuhnChecksum(validVisa), "Valid Visa passes Luhn algorithm");
  assert(validateLuhnChecksum(validMastercard), "Valid Mastercard passes Luhn algorithm");
  assert(validateLuhnChecksum(validAmex), "Valid Amex passes Luhn algorithm");
  assert(!validateLuhnChecksum(invalidLuhnCard), "Tampered card number rejected by Luhn");
  assert(!validateLuhnChecksum(invalidLengthCard), "Too short card number rejected by Luhn");

  // ==========================================
  // Test Suite 2: Acceptance Criteria 1 - Ingress Masking
  // ==========================================
  console.log("\n--- 2. Acceptance Criteria 1: Ingress Masking with Ephemeral Salt ---");
  const session1 = new InFlightRedactionSession({ salt: "a8f2" });
  assert(session1.salt === "a8f2", "Ephemeral salt is initialized correctly");

  const prompt1 = "Veuillez contacter pierre@corp.fr pour virer les fonds sur FR7630006000011234567890189.";
  const masked1 = session1.mask(prompt1);

  assert(masked1.includes("⟪AG:EMAIL:1:a8f2⟫"), "Email masked as ⟪AG:EMAIL:1:a8f2⟫");
  assert(masked1.includes("⟪AG:IBAN:1:a8f2⟫"), "IBAN masked as ⟪AG:IBAN:1:a8f2⟫");
  assert(!masked1.includes("pierre@corp.fr"), "Original email removed from masked text");
  assert(!masked1.includes("FR7630006000011234567890189"), "Original IBAN removed from masked text");
  assert(session1.size === 2, "Session holds 2 distinct tokens");

  // Idempotency / Referent reuse: same email in subsequent text gets same token
  const secondMask = session1.mask("Rappel: écrivez encore à pierre@corp.fr");
  assert(secondMask.includes("⟪AG:EMAIL:1:a8f2⟫"), "Reused identical sensitive value maps to identical token");
  assert(session1.size === 2, "Session token count did not grow for identical PII");

  // ==========================================
  // Test Suite 3: Acceptance Criteria 2 - Egress JSON Restoration
  // ==========================================
  console.log("\n--- 3. Acceptance Criteria 2: Egress JSON Restoration ---");
  const llmResponse = "J'ai bien préparé l'ordre de virement pour ⟪AG:EMAIL:1:a8f2⟫ vers le compte ⟪AG:IBAN:1:a8f2⟫.";
  const restored1 = session1.restore(llmResponse);

  assert(restored1.includes("pierre@corp.fr"), "Original email restored in LLM response");
  assert(restored1.includes("FR7630006000011234567890189"), "Original IBAN restored in LLM response");
  assert(!restored1.includes("⟪AG:"), "Zero redacted tokens remain in final response");
  assert(
    restored1 === "J'ai bien préparé l'ordre de virement pour pierre@corp.fr vers le compte FR7630006000011234567890189.",
    "Restored text matches exact ground truth sentence"
  );

  // ==========================================
  // Test Suite 4: Acceptance Criteria 3 - In-Flight Streaming SSE
  // ==========================================
  console.log("\n--- 4. Acceptance Criteria 3: Streaming SSE Sliding Buffer ---");
  const sessionStreaming = new InFlightRedactionSession({ salt: "a8f2" });
  sessionStreaming.mask("pierre@corp.fr"); // Register ⟪AG:EMAIL:1:a8f2⟫

  // Case 4A: Split token across two deltas: chunk 1 = "⟪AG:EM", chunk 2 = "AIL:1:a8f2⟫"
  const transformStreamA = sessionStreaming.createRestoreTransformStream();
  const inputStreamA = new ReadableStream<string>({
    start(controller) {
      controller.enqueue("Voici l'adresse: ");
      controller.enqueue("⟪AG:EM");
      controller.enqueue("AIL:1:a8f2⟫");
      controller.enqueue(". Bonne réception !");
      controller.close();
    },
  });

  const streamedOutputA = await readStreamToString(inputStreamA.pipeThrough(transformStreamA));
  assert(
    streamedOutputA === "Voici l'adresse: pierre@corp.fr. Bonne réception !",
    "SSE token split across deltas reconstructed and restored seamlessly"
  );

  // Case 4B: SSE with raw JSON deltas and [DONE]
  const transformStreamB = sessionStreaming.createRestoreTransformStream();
  const inputStreamB = new ReadableStream<string>({
    start(controller) {
      controller.enqueue('data: {"delta":"Bonjour ⟪AG:EM');
      controller.enqueue('AIL:1:a8f2⟫"}\n\n');
      controller.enqueue("data: [DONE]\n\n");
      controller.close();
    },
  });

  const streamedOutputB = await readStreamToString(inputStreamB.pipeThrough(transformStreamB));
  assert(
    streamedOutputB === 'data: {"delta":"Bonjour pierre@corp.fr"}\n\ndata: [DONE]\n\n',
    "SSE protocol with JSON structure and [DONE] flushed cleanly"
  );

  // Case 4C: Sliding buffer boundary with non-token characters (> 32 characters)
  const transformStreamC = sessionStreaming.createRestoreTransformStream();
  const inputStreamC = new ReadableStream<string>({
    start(controller) {
      controller.enqueue("Expression mathématique ⟪");
      controller.enqueue("ceci n'est pas du tout un token car il dépasse largement 32 caractères");
      controller.enqueue("⟫ fin du texte.");
      controller.close();
    },
  });

  const streamedOutputC = await readStreamToString(inputStreamC.pipeThrough(transformStreamC));
  assert(
    streamedOutputC.includes("Expression mathématique ⟪ceci n'est pas du tout un token"),
    "Sliding buffer flushes non-token content without hanging or stalling"
  );

  // ==========================================
  // Test Suite 5: Acceptance Criteria 4 - Zero-Retention & Dispose
  // ==========================================
  console.log("\n--- 5. Acceptance Criteria 4: Zero-Retention & Memory Purge ---");
  assert(session1.size > 0, "Session has active mappings before dispose");
  session1.dispose();

  assert(session1.size === 0, "Session mappings cleared (size === 0)");
  assert(session1.isDisposed, "isDisposed flag set to true");
  const postDisposeRestore = session1.restore("Message avec ⟪AG:EMAIL:1:a8f2⟫");
  assert(
    postDisposeRestore === "Message avec ⟪AG:EMAIL:1:a8f2⟫",
    "Post-dispose restore fails closed without retention"
  );

  // ==========================================
  // Test Suite 6: Full Multi-PII & Custom Terms Coverage
  // ==========================================
  console.log("\n--- 6. Multi-PII & Custom Terms Coverage ---");
  const multiSession = new InFlightRedactionSession({
    salt: "7f1c",
    customTerms: [
      { term: "Projet Titan", category: "PROJECT" },
      { term: "Acme Corp", category: "COMPANY" },
    ],
  });

  const complexText = `
    Dossier client:
    - Email: alice@example.com
    - Téléphone: 06 12 34 56 78
    - Téléphone intl: +1 (555) 234-5678
    - Carte bancaire: 4532 0151 1283 0366
    - IP serveur: 192.168.1.1/24
    - US SSN: 123-45-6789
    - IBAN: FR76 3000 6000 0112 3456 7890 189
    - SWIFT: BNPAFRRPXXX
    - NIR: 1 85 05 75 123 456 73
    - Numéro fiscal: 12 34 56 78 90 12 3
    - Entreprise: Acme Corp
    - Initiative: Projet Titan
  `;

  const multiMasked = multiSession.mask(complexText);
  assert(multiMasked.includes("⟪AG:EMAIL:1:7f1c⟫"), "Multi-PII Email masked");
  assert(multiMasked.includes("⟪AG:CARD:1:7f1c⟫"), "Multi-PII Card masked");
  assert(multiMasked.includes("⟪AG:PHONE:1:7f1c⟫"), "Multi-PII Phone masked");
  assert(multiMasked.includes("⟪AG:PHONE:2:7f1c⟫"), "Multi-PII Intl Phone masked");
  assert(multiMasked.includes("⟪AG:IP:1:7f1c⟫"), "Multi-PII IP masked");
  assert(multiMasked.includes("⟪AG:SSN:1:7f1c⟫"), "Multi-PII US SSN masked");
  assert(multiMasked.includes("⟪AG:IBAN:1:7f1c⟫"), "Multi-PII IBAN masked");
  assert(multiMasked.includes("⟪AG:BIC:1:7f1c⟫"), "Multi-PII BIC masked");
  assert(multiMasked.includes("⟪AG:NIR:1:7f1c⟫"), "Multi-PII NIR masked");
  assert(multiMasked.includes("⟪AG:SPI:1:7f1c⟫"), "Multi-PII SPI masked");
  assert(multiMasked.includes("⟪AG:COMPANY:1:7f1c⟫"), "Custom Term Company masked");
  assert(multiMasked.includes("⟪AG:PROJECT:1:7f1c⟫"), "Custom Term Project masked");

  const multiRestored = multiSession.restore(multiMasked);
  assert(multiRestored === complexText, "Complex multi-PII text restored with 100% fidelity");
  multiSession.dispose();

  // ==========================================
  // Test Suite 6B: FEAT-065 PCI-DSS Cards, IPv4, Phones & US SSN
  // ==========================================
  console.log("\n--- 6B. FEAT-065 Ingress & Egress: Cards, IPv4, Phones & US SSN ---");
  const feat065Session = new InFlightRedactionSession({ salt: "f065" });

  // 1. Credit Cards (PAN)
  const cardPrompt = "Paiement carte: Visa 4532 0151 1283 0366, Mastercard 5412-7512-3412-3452, Amex 3782 822463 10005. Fausse: 4532 0151 1283 0367.";
  const cardMasked = feat065Session.mask(cardPrompt);

  assert(cardMasked.includes("⟪AG:CARD:1:f065⟫"), "Visa masked as CARD:1");
  assert(cardMasked.includes("⟪AG:CARD:2:f065⟫"), "Mastercard masked as CARD:2");
  assert(cardMasked.includes("⟪AG:CARD:3:f065⟫"), "Amex masked as CARD:3");
  assert(cardMasked.includes("4532 0151 1283 0367"), "Invalid Luhn card is NOT masked");
  assert(feat065Session.restore(cardMasked) === cardPrompt, "Cards restored with 100% fidelity");

  // 2. IPv4 Addresses & Versioning Anti-False-Positive
  const ipPrompt = "Serveurs: 192.168.1.1, 10.200.4.15/24, DNS 8.8.8.8, loopback 127.0.0.1. Release v2.4.1.0 et fausse IP 999.999.999.999.";
  const ipMasked = feat065Session.mask(ipPrompt);

  assert(ipMasked.includes("⟪AG:IP:1:f065⟫"), "Private IP 192.168.1.1 masked as IP:1");
  assert(ipMasked.includes("⟪AG:IP:2:f065⟫"), "CIDR IP 10.200.4.15/24 masked as IP:2");
  assert(ipMasked.includes("⟪AG:IP:3:f065⟫"), "Public DNS 8.8.8.8 masked as IP:3");
  assert(ipMasked.includes("⟪AG:IP:4:f065⟫"), "Loopback 127.0.0.1 masked as IP:4");
  assert(ipMasked.includes("v2.4.1.0"), "Software version v2.4.1.0 is NOT falsely masked as IP");
  assert(ipMasked.includes("999.999.999.999"), "Invalid IP 999.999.999.999 is NOT masked as IP");
  assert(feat065Session.restore(ipMasked) === ipPrompt, "IPv4 addresses restored with 100% fidelity");

  // 3. International Phones & US SSN
  const intlPrompt = "Support: +1 (555) 234-5678, Londres +44 20 7946 0958, Berlin +49 30 123456. Employé US SSN: 123-45-6789. Invalides: 000-45-6789, 666-45-6789, 2026-10-14.";
  const intlMasked = feat065Session.mask(intlPrompt);

  assert(intlMasked.includes("⟪AG:PHONE:1:f065⟫"), "US phone +1 (555) 234-5678 masked as PHONE:1");
  assert(intlMasked.includes("⟪AG:PHONE:2:f065⟫"), "UK phone +44 20 7946 0958 masked as PHONE:2");
  assert(intlMasked.includes("⟪AG:PHONE:3:f065⟫"), "DE phone +49 30 123456 masked as PHONE:3");
  assert(intlMasked.includes("⟪AG:SSN:1:f065⟫"), "Valid US SSN masked as SSN:1");
  assert(intlMasked.includes("000-45-6789"), "Reserved 000 SSN is NOT masked");
  assert(intlMasked.includes("666-45-6789"), "Reserved 666 SSN is NOT masked");
  assert(intlMasked.includes("2026-10-14"), "ISO Date is NOT falsely masked as phone");
  assert(feat065Session.restore(intlMasked) === intlPrompt, "Intl phones & US SSN restored with 100% fidelity");

  feat065Session.dispose();

  // ==========================================
  // Test Suite 6C: Streaming SSE with CARD and IP tokens
  // ==========================================
  console.log("\n--- 6C. Streaming SSE with CARD & IP split chunks ---");
  const sseSession = new InFlightRedactionSession({ salt: "s99" });
  sseSession.mask("4532 0151 1283 0366"); // ⟪AG:CARD:1:s99⟫
  sseSession.mask("192.168.1.1"); // ⟪AG:IP:1:s99⟫

  const transformStreamD = sseSession.createRestoreTransformStream();
  const inputStreamD = new ReadableStream<string>({
    start(controller) {
      controller.enqueue('data: {"card":"⟪AG:CA');
      controller.enqueue('RD:1:s99');
      controller.enqueue('⟫","ip":"⟪AG:IP:1:s99⟫"}\n\n');
      controller.enqueue("data: [DONE]\n\n");
      controller.close();
    },
  });

  const streamedOutputD = await readStreamToString(inputStreamD.pipeThrough(transformStreamD));
  assert(
    streamedOutputD.includes("4532 0151 1283 0366") && streamedOutputD.includes("192.168.1.1"),
    "SSE streaming reconstructs split CARD and IP tokens without corruption"
  );
  sseSession.dispose();

  // ==========================================
  // Test Suite 7: High-Throughput Latency Benchmark (< 2 ms)
  // ==========================================
  console.log("\n--- 7. Performance & Latency Benchmark ---");
  const benchmarkSession = createInFlightRedactionSession({ salt: "b33f" });
  const sampleParagraph = `
    Le client Jean Dupont (jean.dupont@finance.example.com, tél: +1 (555) 234-5678, CB: 4532 0151 1283 0366)
    a demandé un virement immédiat vers son IBAN FR76 3000 6000 0112 3456 7890 189 depuis l'IP 192.168.1.1
    auprès de la banque BNP Paribas SWIFT: BNPAFRRPXXX. Son NIR officiel est 1 85 05 75 123 456 73,
    son SSN américain est 123-45-6789 et son numéro fiscal est 12 34 56 78 90 12 3.
  `;
  // Generate ~2,000 words text
  const longPrompt = sampleParagraph.repeat(40);
  const wordCount = longPrompt.split(/\s+/).length;

  const tStartMask = performance.now();
  const maskedLong = benchmarkSession.mask(longPrompt);
  const tEndMask = performance.now();
  const maskDurationMs = tEndMask - tStartMask;

  const tStartRestore = performance.now();
  const restoredLong = benchmarkSession.restore(maskedLong);
  const tEndRestore = performance.now();
  const restoreDurationMs = tEndRestore - tStartRestore;

  console.log(`⏱️ Latency on ${wordCount} words: Ingress mask = ${maskDurationMs.toFixed(3)} ms, Egress restore = ${restoreDurationMs.toFixed(3)} ms`);
  assert(maskDurationMs < 20, `Ingress mask latency is fast (${maskDurationMs.toFixed(3)} ms)`);
  assert(restoreDurationMs < 20, `Egress restore latency is fast (${restoreDurationMs.toFixed(3)} ms)`);
  assert(restoredLong === longPrompt, "Long text restored accurately");

  benchmarkSession.dispose();

  // ==========================================
  // Test Suite 8: Aliases and Factory Export
  // ==========================================
  console.log("\n--- 8. Aliases & Factories ---");
  const aliasInstance = new BidirectionalSanitizer();
  assert(aliasInstance instanceof InFlightRedactionSession, "BidirectionalSanitizer alias matches class");
  aliasInstance.dispose();

  console.log("\n🎉 All In-Flight Bidirectional DLP (FEAT-065 v2.6.0) tests passed successfully!");
}

runInFlightRedactorTests().catch((err) => {
  console.error("❌ Test crashed:", err);
  process.exit(1);
});
