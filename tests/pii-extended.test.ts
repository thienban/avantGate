import { sanitizePII } from "../src/sanitizer";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runPIITests() {
  console.log("🔒 Testing Extended PII Masking...\n");

  // 1. French NIR / SSN
  const ssnStandard = "NIR du gérant : 1 85 05 75 123 456 78";
  const sanitizedSSN1 = sanitizePII(ssnStandard);
  assert(sanitizedSSN1.text.includes("[REDACTED_NIR]"), "Standard 15-digit NIR masked");

  const ssnCorsica = "Gérant né en Corse : 2 90 04 2A 123 456";
  const sanitizedCorsica = sanitizePII(ssnCorsica);
  assert(sanitizedCorsica.text.includes("[REDACTED_NIR]"), "NIR with Corsica department (2A) masked");

  // 2. French Tax Number (SPI)
  const spiLabelled = "Numéro fiscal : 12 34 56 78 90 12 3";
  const sanitizedSPI1 = sanitizePII(spiLabelled);
  assert(sanitizedSPI1.text.includes("[REDACTED_SPI]"), "Labelled French tax number (SPI) masked");

  const spiPure = "Déclarant fiscal 0123456789012.";
  const sanitizedSPI2 = sanitizePII(spiPure);
  assert(sanitizedSPI2.text.includes("[REDACTED_SPI]"), "Autonomous 13-digit SPI starting with 0 masked");

  // 3. Multiline / Complex IBAN
  const ibanMultiline = `
    IBAN du compte :
    FR76 3000
    6000 0112
    3456 7890 189
  `;
  const sanitizedIBAN = sanitizePII(ibanMultiline);
  assert(sanitizedIBAN.text.includes("[REDACTED_IBAN]"), "Multiline formatted IBAN masked");

  // 4. BIC / SWIFT
  const bicText = "SWIFT: BNPAFRRPXXX";
  const sanitizedBIC = sanitizePII(bicText);
  assert(sanitizedBIC.text.includes("[REDACTED_BIC"), "BIC/SWIFT code masked");

  // 5. Non-regression: Unix 13-digit timestamp must NOT be masked as SPI
  const timestampText = "Timestamp de l'événement : 1715420000000 ms";
  const sanitizedTS = sanitizePII(timestampText);
  assert(!sanitizedTS.text.includes("[REDACTED_SPI]"), "Unix 13-digit timestamp is not falsely redacted as SPI");
  assert(sanitizedTS.text.includes("1715420000000"), "Exact timestamp preserved");

  console.log("\n🎉 All extended PII tests passed successfully!");
}

runPIITests().catch((err) => {
  console.error("❌ PII tests crashed:", err);
  process.exit(1);
});
