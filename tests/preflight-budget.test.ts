import {
  createAvantGate,
  ConfigurationError,
  BudgetExceededError,
  PricingRegistry,
  CachedPricingAdapter,
  calculateCostUSD,
  type LLMProviderPort,
  type PricingAdapter,
  type ModelPrice,
} from "../src/index";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
}

async function runTests() {
  console.log("🛡️ Testing AvantGate Pre-Flight Budget Guards & Distributor Pricing Engine...\n");

  // =========================================================================
  // Test 1: Pre-flight token budget check (User Reviewer Scenario)
  // =========================================================================
  const mockWorkingClient: LLMProviderPort = {
    name: "mock-working",
    async complete() {
      return { text: "Real network response", usage: { promptTokens: 25, completionTokens: 10, totalTokens: 35 } };
    },
  };

  const budgetRestrictedGate = createAvantGate({
    primary: {
      provider: "deepseek",
      model: "deepseek-chat",
      client: mockWorkingClient,
    },
    maxTokenBudget: 1, // Deliberately small budget
  });

  let tokenBudgetBlocked = false;
  try {
    await budgetRestrictedGate.execute({
      systemPrompt: "You are a helpful legal and financial assistant.",
      userQuery: "Summarize the key differences between EBITDA and Operating Income.",
    });
  } catch (err: any) {
    tokenBudgetBlocked = err instanceof BudgetExceededError;
    assert(tokenBudgetBlocked, "BudgetExceededError thrown when estimated prompt exceeds maxTokenBudget: 1");
    assert(err.message.includes("Pre-flight token budget exceeded"), "Error message explicitly mentions pre-flight budget guard");
  }
  assert(tokenBudgetBlocked, "Request was intercepted before dispatching to provider");

  // =========================================================================
  // Test 2: Pre-flight cost budget check & Pricing requirement
  // =========================================================================
  // 2a. Attempting to enforce maxCostUSD without configuring pricing throws ConfigurationError
  const unpricedCostGate = createAvantGate({
    primary: {
      provider: "openai",
      model: "gpt-4o",
      client: mockWorkingClient,
      // No pricing configured
    },
    maxCostUSD: 0.000001,
  });

  let unpricedConfigBlocked = false;
  try {
    await unpricedCostGate.execute({ userQuery: "Cost check without pricing" });
  } catch (err: any) {
    unpricedConfigBlocked = err instanceof ConfigurationError;
    assert(unpricedConfigBlocked, "ConfigurationError thrown when maxCostUSD is active but no pricing is configured");
    assert(err.message.includes("no pricing was configured"), "Error tells user to define pricing");
  }
  assert(unpricedConfigBlocked, "Refuses to guess arbitrary prices when enforcing budget limits");

  // 2b. When pricing is provided, budget guard intercepts pre-flight
  const costRestrictedGate = createAvantGate({
    primary: {
      provider: "openai",
      model: "gpt-4o",
      client: mockWorkingClient,
      pricing: {
        promptUSDPerMillion: 2.50,
        completionUSDPerMillion: 10.00,
      },
    },
    maxCostUSD: 0.000001, // Max budget way below prompt cost on gpt-4o
  });

  let costBudgetBlocked = false;
  try {
    await costRestrictedGate.execute({
      systemPrompt: "You are an enterprise financial auditor analyzing balance sheets.",
      userQuery: "Explain revenue recognition under IFRS 15 in exhaustive detail with examples.",
    });
  } catch (err: any) {
    costBudgetBlocked = err instanceof BudgetExceededError;
    assert(costBudgetBlocked, "BudgetExceededError thrown when estimated prompt cost exceeds maxCostUSD");
    assert(err.message.includes("Pre-flight cost budget exceeded"), "Error message explicitly mentions cost budget guard");
  }
  assert(costBudgetBlocked, "Expensive call was blocked pre-flight without spending money");

  // =========================================================================
  // Test 3: Elimination of silent simulation (Throws ConfigurationError)
  // =========================================================================
  const emptyProviderGate = createAvantGate({
    primary: {
      provider: "deepseek",
      model: "deepseek-chat",
      // No client and no apiKey provided
    },
  });

  let configErrorThrown = false;
  try {
    await emptyProviderGate.execute({
      userQuery: "Test without credentials or client",
    });
  } catch (err: any) {
    configErrorThrown = err instanceof ConfigurationError;
    assert(configErrorThrown, "ConfigurationError thrown when provider chain has no operational clients");
    assert(err.message.includes("No active LLM provider configured"), "Error guides user to provide a client or credentials");
  }
  assert(configErrorThrown, "AvantGate refuses to silently simulate without explicit mockSimulation flag");

  // =========================================================================
  // Test 4: Explicit mock simulation flag (Opt-in for test harnesses)
  // =========================================================================
  const explicitMockGate = createAvantGate({
    primary: {
      provider: "deepseek",
      model: "deepseek-chat",
    },
    mockSimulation: true,
  });

  const simResult = await explicitMockGate.execute({
    userQuery: "Simulation request",
  });
  assert(simResult.text.includes("[AvantGate In-Process Engine]"), "Simulation permitted only when mockSimulation is explicitly true");

  // =========================================================================
  // Test 5: Option A (Strict & Truthful) - Zero-hardcode pricing resolution
  // =========================================================================
  // 5a. Unregistered model returns 0 cost (no fake numbers)
  const unconfiguredCost = calculateCostUSD("unconfigured-model", 1_000_000, 1_000_000);
  assert(unconfiguredCost === 0, "Unconfigured model returns $0 cost (Strict & Truthful: no fake guessing)");

  // 5b. PricingRegistry explicitly populated
  PricingRegistry.registerPrice("deepseek-chat", { promptUSDPerMillion: 0.14, completionUSDPerMillion: 0.28 });
  const deepseekCost = calculateCostUSD("deepseek-chat", 1_000_000, 1_000_000);
  assert(Math.abs(deepseekCost - 0.42) < 0.001, "Registered DeepSeek cost equals $0.42 per M tokens");

  // 5c. OpenRouter distributor-specific pricing
  PricingRegistry.registerPrice("openrouter/anthropic/claude-3.5-sonnet", {
    promptUSDPerMillion: 3.00,
    completionUSDPerMillion: 15.00,
  });
  const sonnetCost = calculateCostUSD("anthropic/claude-3.5-sonnet", 1_000_000, 1_000_000, 0, "openrouter");
  assert(Math.abs(sonnetCost - 18.0) < 0.001, "OpenRouter distributor-specific model price resolved correctly");

  // 5d. ProviderConfig pricing override (e.g. enterprise discount)
  const customProviderGate = createAvantGate({
    primary: {
      provider: "mistral",
      model: "mistral-large-latest",
      client: mockWorkingClient,
      pricing: {
        promptUSDPerMillion: 1.00, // 50% enterprise discount
        completionUSDPerMillion: 3.00,
      },
    },
  });

  const discountedResult = await customProviderGate.execute({
    userQuery: "Calculer coût avec remise",
  });
  assert(discountedResult.costUSD > 0, "Execution succeeded with custom provider pricing");

  // =========================================================================
  // Test 6: PricingAdapter with CachedPricingAdapter (DB Simulation)
  // =========================================================================
  let dbQueryCount = 0;
  const mockDbAdapter: PricingAdapter = {
    async fetchPrice(model: string, provider?: string): Promise<ModelPrice | undefined> {
      dbQueryCount++;
      if (model === "proprietary-fintech-v1") {
        return { promptUSDPerMillion: 0.80, completionUSDPerMillion: 2.40 };
      }
      return undefined;
    },
  };

  const cachedAdapter = new CachedPricingAdapter(mockDbAdapter, 5000);

  // First call hits DB
  const price1 = await cachedAdapter.fetchPrice("proprietary-fintech-v1", "custom");
  assert(price1?.promptUSDPerMillion === 0.80, "CachedPricingAdapter fetched price from mock DB");
  assert(dbQueryCount === 1, "DB was queried exactly once");

  // Second call within TTL hits in-memory cache (0 ms, 0 DB queries)
  const price2 = await cachedAdapter.fetchPrice("proprietary-fintech-v1", "custom");
  assert(price2?.promptUSDPerMillion === 0.80, "Cached price retrieved successfully");
  assert(dbQueryCount === 1, "DB was NOT re-queried (cache hit)");

  // Invalidate cache
  cachedAdapter.clearCache();
  const price3 = await cachedAdapter.fetchPrice("proprietary-fintech-v1", "custom");
  assert(price3?.promptUSDPerMillion === 0.80, "Price re-fetched after cache clear");
  assert(dbQueryCount === 2, "DB was queried again following cache invalidation");

  // =========================================================================
  // Test 7: Native HttpProviderClient Auto-Resolution & 401 Error Handling
  // =========================================================================
  // Mock global fetch to simulate provider responses
  const originalFetch = globalThis.fetch;

  try {
    // 7a. Mock HTTP 401 Unauthorized
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ error: { message: "Invalid API Key" } }), {
        status: 401,
        statusText: "Unauthorized",
      });
    };

    const httpGate = createAvantGate({
      primary: {
        provider: "deepseek",
        model: "deepseek-chat",
        apiKey: "sk-invalid-key-deliberate",
      },
    });

    let http401Intercepted = false;
    try {
      await httpGate.execute({ userQuery: "Test network call with invalid key" });
    } catch (err: any) {
      http401Intercepted = err.message.includes("401");
      assert(http401Intercepted, "Native HttpProviderClient performed fetch and caught HTTP 401");
    }
    assert(http401Intercepted, "Real network call was made instead of silent simulation");

    // 7b. Mock HTTP 200 Success with OpenAI compatible response
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "EBITDA measures operating cash profitability." } }],
          usage: { prompt_tokens: 15, completion_tokens: 8, total_tokens: 23 },
        }),
        { status: 200, statusText: "OK", headers: { "Content-Type": "application/json" } }
      );
    };

    const successfulHttpResult = await httpGate.execute({
      userQuery: "Define EBITDA",
    });

    assert(successfulHttpResult.text === "EBITDA measures operating cash profitability.", "Native HttpProviderClient parsed response text");
    assert(successfulHttpResult.tokens.total === 23, "Native HttpProviderClient extracted token usage");
    assert(successfulHttpResult.costUSD > 0, "Real-time cost calculated from native HTTP execution");

  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("\n🎉 All preflight-budget & distributor pricing tests passed successfully!");
}

runTests().catch((err) => {
  console.error("❌ Test crashed:", err);
  process.exit(1);
});
