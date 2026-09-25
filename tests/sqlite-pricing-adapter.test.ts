import fs from "fs";
import path from "path";
import {
  createAvantGate,
  CachedPricingAdapter,
  SqlitePricingAdapter,
  type LLMProviderPort,
  BudgetExceededError,
} from "../src/index";

const assert = (condition: boolean, msg: string): void => {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
};

const runTests = async (): Promise<void> => {
  console.log("💰 Testing SqlitePricingAdapter & FinOps Persistence...\n");

  let hasNativeSqlite = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("node:sqlite");
  } catch {
    hasNativeSqlite = false;
  }

  if (!hasNativeSqlite) {
    console.log(
      `⚠️ SKIPPING native SqlitePricingAdapter tests: Node runtime ${process.version} does not support built-in 'node:sqlite' (requires Node.js 22.5+).\n`
    );
    return;
  }

  // =========================================================================
  // Test 1: In-memory SqlitePricingAdapter initialization & basic lookup
  // =========================================================================
  const adapter = new SqlitePricingAdapter({ dbPath: ":memory:" });

  adapter.upsertPrice("deepseek", "deepseek-chat", {
    promptUSDPerMillion: 0.14,
    completionUSDPerMillion: 0.28,
    cacheHitUSDPerMillion: 0.014,
  });

  const priceDirect = adapter.fetchPrice("deepseek-chat", "deepseek");
  assert(priceDirect !== undefined, "fetchPrice('deepseek-chat', 'deepseek') finds registered price");
  assert(priceDirect?.promptUSDPerMillion === 0.14, "prompt price is 0.14 USD per million");
  assert(priceDirect?.completionUSDPerMillion === 0.28, "completion price is 0.28 USD per million");
  assert(priceDirect?.cacheHitUSDPerMillion === 0.014, "cache hit price is 0.014 USD per million");

  // =========================================================================
  // Test 2: Fallback lookups (model alone and provider/model slash format)
  // =========================================================================
  const priceSlash = adapter.fetchPrice("deepseek/deepseek-chat");
  assert(priceSlash !== undefined, "fetchPrice('deepseek/deepseek-chat') resolves with slash format");
  assert(priceSlash?.promptUSDPerMillion === 0.14, "slash format prompt price is correct");

  const priceModelOnly = adapter.fetchPrice("deepseek-chat");
  assert(priceModelOnly !== undefined, "fetchPrice('deepseek-chat') resolves model without provider");

  const missingPrice = adapter.fetchPrice("unknown-model", "unknown-provider");
  assert(missingPrice === undefined, "fetchPrice returns undefined for unconfigured model");

  // =========================================================================
  // Test 3: Upsert update & Deletion
  // =========================================================================
  adapter.upsertPrice("mistral", "mistral-small", {
    promptUSDPerMillion: 0.20,
    completionUSDPerMillion: 0.60,
  });

  const beforeDelete = adapter.fetchPrice("mistral-small", "mistral");
  assert(beforeDelete !== undefined, "mistral-small exists before delete");

  const deleted = adapter.deletePrice("mistral", "mistral-small");
  assert(deleted === true, "deletePrice returns true when row is removed");

  const afterDelete = adapter.fetchPrice("mistral-small", "mistral");
  assert(afterDelete === undefined, "mistral-small is undefined after delete");

  // =========================================================================
  // Test 4: Default seeding via seedDefaultPrices
  // =========================================================================
  const seedCount = adapter.seedDefaultPrices();
  assert(seedCount > 0, `seedDefaultPrices successfully seeded ${seedCount} models`);

  const gpt4oPrice = adapter.fetchPrice("gpt-4o", "openai");
  assert(gpt4oPrice !== undefined, "Seeded gpt-4o price exists");
  assert(gpt4oPrice?.promptUSDPerMillion === 2.50, "gpt-4o prompt price matches SEED_MODEL_PRICES ($2.50/M)");

  const allPrices = adapter.getAllPrices();
  assert(allPrices.length >= seedCount, "getAllPrices returns list of configured model prices");

  // Second seed should be idempotent
  const secondSeedCount = adapter.seedDefaultPrices(false);
  assert(secondSeedCount === 0, "seedDefaultPrices with force=false is idempotent and returns 0");

  // =========================================================================
  // Test 5: Integration with CachedPricingAdapter (0 ms RAM Cache & Invalidation)
  // =========================================================================
  const cachedAdapter = new CachedPricingAdapter(adapter, 60 * 1000);

  const priceCached = await cachedAdapter.fetchPrice("gpt-4o", "openai");
  assert(priceCached !== undefined, "CachedPricingAdapter fetched price from SQLite");

  const peeked = cachedAdapter.peek("gpt-4o", "openai");
  assert(peeked !== undefined && peeked.promptUSDPerMillion === 2.50, "CachedPricingAdapter peeked directly from RAM");

  // Invalidate and verify
  cachedAdapter.invalidate("gpt-4o", "openai");
  assert(cachedAdapter.peek("gpt-4o", "openai") === undefined, "peek is undefined immediately after cache invalidation");

  // =========================================================================
  // Test 6: Integration with createAvantGate & pre-flight maxCostUSD budget
  // =========================================================================
  const mockClient: LLMProviderPort = {
    name: "mock-sqlite-client",
    async complete() {
      return {
        text: "Response from model",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      };
    },
  };

  const gate = createAvantGate({
    primary: {
      provider: "deepseek",
      model: "deepseek-chat",
      client: mockClient,
    },
    pricingAdapter: adapter,
    maxCostUSD: 0.005, // Sufficient budget
  });

  const res = await gate.execute({
    systemPrompt: "You are a FinOps advisor.",
    userQuery: "Calculate cost for this prompt.",
  });

  assert(res.costUSD > 0, `Query executed and exact cost was calculated: $${res.costUSD}`);

  // Test budget exceeded with tiny budget
  const strictGate = createAvantGate({
    primary: {
      provider: "deepseek",
      model: "deepseek-chat",
      client: mockClient,
    },
    pricingAdapter: adapter,
    maxCostUSD: 0.0000001, // Intentionally tiny budget to trigger guard
  });

  let budgetBlocked = false;
  try {
    await strictGate.execute({
      systemPrompt: "You are a FinOps advisor.",
      userQuery: "This prompt should exceed the budget guard.",
    });
  } catch (err) {
    budgetBlocked = err instanceof BudgetExceededError;
  }
  assert(budgetBlocked, "maxCostUSD pre-flight guard blocked execution using SQLite price");

  // =========================================================================
  // Test 7: Persistent SQLite file on disk
  // =========================================================================
  const tmpDbPath = path.resolve(process.cwd(), "tests", "scratch", "test-pricing.db");
  const fileAdapter = new SqlitePricingAdapter({ dbPath: tmpDbPath, autoSeed: true });

  const diskPrice = fileAdapter.fetchPrice("deepseek-chat", "deepseek");
  assert(diskPrice !== undefined, "Persistent SQLite file was created and auto-seeded");

  fileAdapter.close();
  adapter.close();

  // Cleanup test scratch file
  if (fs.existsSync(tmpDbPath)) {
    fs.unlinkSync(tmpDbPath);
  }
  const scratchDir = path.dirname(tmpDbPath);
  if (fs.existsSync(scratchDir) && fs.readdirSync(scratchDir).length === 0) {
    fs.rmdirSync(scratchDir);
  }

  console.log("\n🎉 All SqlitePricingAdapter FinOps tests passed successfully!\n");
};

runTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});
