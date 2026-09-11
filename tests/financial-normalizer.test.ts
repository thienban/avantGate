import { z } from "zod";
import {
  AccountingFactory,
  FrenchPCGStrategy,
  UsGAAPStrategy,
  UkIFRSStrategy,
  SwissCOStrategy,
  cleanFinancialJSON,
  withFinancialNormalizer,
} from "../src/finance/index";
import { validateWithZod } from "../src/response-validator";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runFinanceTests() {
  console.log("💰 Testing avantgate/finance Module...\n");

  // 1. FrenchPCGStrategy cleanNumber
  const fr = new FrenchPCGStrategy();
  assert(fr.cleanNumber("(150 000)") === -150000, "FR: Negative in parentheses (150 000) -> -150000");
  assert(fr.cleanNumber("( 150 000 € )") === -150000, "FR: Negative with currency ( 150 000 € ) -> -150000");
  assert(fr.cleanNumber("1 850 000,50 €") === 1850000.5, "FR: Comma and space format 1 850 000,50 € -> 1850000.5");
  assert(fr.cleanNumber("1 850 k€") === 1850000, "FR: Magnitude k€ -> 1850000");
  assert(fr.cleanNumber("2.4 M€") === 2400000, "FR: Magnitude M€ -> 2400000");

  // 2. UsGAAPStrategy cleanNumber
  const us = new UsGAAPStrategy();
  assert(us.cleanNumber("(150,000)") === -150000, "US: Negative (150,000) -> -150000");
  assert(us.cleanNumber("[50,000]") === -50000, "US: Negative bracket [50,000] -> -50000");
  assert(us.cleanNumber("$1.5M") === 1500000, "US: $1.5M -> 1500000");
  assert(us.cleanNumber("$250K") === 250000, "US: $250K -> 250000");

  // 3. UkIFRSStrategy cleanNumber
  const uk = new UkIFRSStrategy();
  assert(uk.cleanNumber("£750,000") === 750000, "UK: £750,000 -> 750000");
  assert(uk.cleanNumber("(25,000)") === -25000, "UK: (25,000) -> -25000");

  // 4. SwissCOStrategy cleanNumber
  const ch = new SwissCOStrategy();
  assert(ch.cleanNumber("1'850'000.50 CHF") === 1850000.5, "CH: Swiss apostrophe 1'850'000.50 CHF -> 1850000.5");
  assert(ch.cleanNumber("(150'000)") === -150000, "CH: Negative (150'000) -> -150000");

  // 5. AccountingFactory resolution & detection
  const detectedFR = AccountingFactory.detectStrategy("Bilan actif et liasse fiscale Cerfa 2050");
  assert(detectedFR.jurisdictionCode === "FR", "Factory detects French Cerfa context");

  const detectedUS = AccountingFactory.detectStrategy("Form 10-K SEC filing with GAAP balance sheet");
  assert(detectedUS.jurisdictionCode === "US", "Factory detects US GAAP context");

  const detectedUK = AccountingFactory.detectStrategy("Companies House FRS 102 filing with £ turnover");
  assert(detectedUK.jurisdictionCode === "UK", "Factory detects UK IFRS context");

  const detectedCH = AccountingFactory.detectStrategy("Conformité Code des obligations art. 725 CO pour CHE-123.456.789");
  assert(detectedCH.jurisdictionCode === "CH", "Factory detects Swiss CO context");

  // 6. cleanFinancialJSON & Non-regression on regular text
  const dirtyJSON = `
    {
      "company": "LexTalk SAS (Holding)",
      "observation": "Voir note (annexe 3) pour détails",
      "turnover": "1 850 k€",
      "net_result": (150 000),
      "cash": "1 850 000,50 €",
      "provisions": "(45 000 €)",
      "operating_cost": "1 850 000,50",
      "margin_rate": "12,50",
      "siren": "123456789",
      "postal_code": "75001"
    }
  `;

  const cleaned = cleanFinancialJSON(dirtyJSON, { jurisdiction: "FR" });
  const parsed = JSON.parse(cleaned);

  assert(parsed.company === "LexTalk SAS (Holding)", "Non-regression: company text with parentheses preserved");
  assert(parsed.observation === "Voir note (annexe 3) pour détails", "Non-regression: observation text preserved");
  assert(parsed.turnover === 1850000, "cleanFinancialJSON converts k€ to numeric 1850000");
  assert(parsed.net_result === -150000, "cleanFinancialJSON converts unquoted (150 000) to -150000");
  assert(parsed.cash === 1850000.5, "cleanFinancialJSON converts comma currency to 1850000.5");
  assert(parsed.provisions === -45000, "cleanFinancialJSON converts quoted (45 000 €) to -45000");
  assert(parsed.operating_cost === 1850000.5, "cleanFinancialJSON converts French number without currency '1 850 000,50' to 1850000.5");
  assert(parsed.margin_rate === 12.5, "cleanFinancialJSON converts decimal comma '12,50' to 12.5");
  assert(parsed.siren === "123456789", "Non-regression: SIREN string without spaces/comma remains string");
  assert(parsed.postal_code === "75001", "Non-regression: postal code remains string");

  // 7. validateWithZod with financialNormalizer
  const schema = z.object({
    company: z.string(),
    turnover: z.number(),
    net_result: z.number(),
    cash: z.number(),
  });

  const validated = validateWithZod(dirtyJSON, schema, { financialNormalizer: true, jurisdiction: "FR" });
  assert(validated.turnover === 1850000, "validateWithZod integrates financialNormalizer");
  assert(validated.net_result === -150000, "validateWithZod validates negative numbers accurately");

  // 8. withFinancialNormalizer pipeline wrapper
  const normalizer = withFinancialNormalizer({ jurisdiction: "FR" });
  const transformed = normalizer(`{"ca": "2.4 M€"}`);
  assert(JSON.parse(transformed).ca === 2400000, "withFinancialNormalizer works as pipeline transformer");

  console.log("\n🎉 All finance tests passed successfully!");
}

runFinanceTests().catch((err) => {
  console.error("❌ Finance tests crashed:", err);
  process.exit(1);
});
