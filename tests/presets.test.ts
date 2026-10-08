import {
  createAvantGate,
  PRESETS,
  type LLMProviderPort,
  SecretLeakBlockedError,
} from "../src/index";

const assert = (condition: boolean, msg: string): void => {
  if (!condition) {
    console.error(`❌ FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`✅ PASS: ${msg}`);
};

const createMockProvider = (responseText: string): LLMProviderPort => ({
  name: "mock-provider",
  complete: async () => ({
    text: responseText,
    usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
  }),
});

const defaultPricing = { promptUSDPerMillion: 1.0, completionUSDPerMillion: 2.0 };

const runLaunchSafePresetTest = async (): Promise<void> => {
  const provider = createMockProvider("Safe response text");
  const config = PRESETS.LAUNCH_SAFE({
    primary: { provider: "custom", model: "model-launch", client: provider, pricing: defaultPricing },
  });

  assert(config.security?.detectPromptInjection === true, "LAUNCH_SAFE activates prompt injection guard");
  assert(config.security?.maskPII === true, "LAUNCH_SAFE activates PII mask");
  assert(config.security?.outputDLP === true, "LAUNCH_SAFE activates output DLP");
  assert(config.security?.blockSecretLeaks === true, "LAUNCH_SAFE activates secret leak guard");
  assert(config.security?.secretLeakAction === "REDACT", "LAUNCH_SAFE sets secret leak action to REDACT");
  assert(config.maxTokenBudget === 8192, "LAUNCH_SAFE sets maxTokenBudget to 8192");
  assert(config.maxCostUSD === 0.5, "LAUNCH_SAFE sets maxCostUSD to 0.50");
  assert(config.retryOptions?.maxRetries === 2, "LAUNCH_SAFE sets maxRetries to 2");

  const gate = createAvantGate(config);
  const result = await gate.execute({ userQuery: "Hello world" });
  assert(result.text === "Safe response text", "LAUNCH_SAFE gate executes query successfully");
};

const runLaunchSafeRedactionTest = async (): Promise<void> => {
  const leakyProvider = createMockProvider("Leaking key: sk-ant-api03-abcdef1234567890abcdef12");
  const gate = createAvantGate(
    PRESETS.LAUNCH_SAFE({
      primary: { provider: "custom", model: "model-leaky", client: leakyProvider, pricing: defaultPricing },
    })
  );

  const result = await gate.execute({ userQuery: "Trigger leak" });
  assert(!result.text.includes("sk-ant-api03-"), "LAUNCH_SAFE redacts leaked secret key");
  assert(result.text.includes("[REDACTED_ANTHROPIC_KEY]"), "LAUNCH_SAFE inserts redaction placeholder");
};

const runEnterpriseStrictPresetTest = async (): Promise<void> => {
  const leakyProvider = createMockProvider("Enterprise leak: sk-proj-1234567890abcdef1234567890abcdef");
  const config = PRESETS.ENTERPRISE_STRICT({
    primary: { provider: "custom", model: "model-strict", client: leakyProvider, pricing: defaultPricing },
  });

  assert(config.security?.blockSecretLeaks === true, "ENTERPRISE_STRICT activates secret leak check");
  assert(config.security?.secretLeakAction === "BLOCK", "ENTERPRISE_STRICT sets secretLeakAction to BLOCK");
  assert(config.maxTokenBudget === 4096, "ENTERPRISE_STRICT restricts maxTokenBudget to 4096");
  assert(config.maxCostUSD === 0.15, "ENTERPRISE_STRICT restricts maxCostUSD to 0.15");
  assert(config.retryOptions?.maxRetries === 3, "ENTERPRISE_STRICT sets maxRetries to 3");

  const gate = createAvantGate(config);
  let blocked = false;
  try {
    await gate.execute({ userQuery: "Trigger strict leak" });
  } catch (err: unknown) {
    if (err instanceof SecretLeakBlockedError) {
      blocked = true;
    }
  }
  assert(blocked, "ENTERPRISE_STRICT hard-blocks request with SecretLeakBlockedError");
};

const runDevPermissivePresetTest = async (): Promise<void> => {
  const provider = createMockProvider("Dev text");
  const config = PRESETS.DEV_PERMISSIVE({
    primary: { provider: "custom", model: "model-dev", client: provider },
  });

  assert(config.security?.detectPromptInjection === false, "DEV_PERMISSIVE relaxes prompt injection");
  assert(config.security?.maskPII === false, "DEV_PERMISSIVE relaxes PII mask");
  assert(config.security?.outputDLP === false, "DEV_PERMISSIVE relaxes output DLP");
  assert(config.security?.blockSecretLeaks === false, "DEV_PERMISSIVE relaxes secret inspection");
  assert(config.maxTokenBudget === undefined, "DEV_PERMISSIVE leaves token budget unrestricted");

  const gate = createAvantGate(config);
  const res = await gate.execute({ userQuery: "Dev query" });
  assert(res.text === "Dev text", "DEV_PERMISSIVE executes without blocking");
};

const runCustomOverridesTest = async (): Promise<void> => {
  const provider = createMockProvider("Overridden text");
  const config = PRESETS.LAUNCH_SAFE({
    primary: { provider: "custom", model: "model-custom", client: provider },
    maxCostUSD: 2.0,
    security: {
      maskPII: false,
    },
  });

  assert(config.maxCostUSD === 2.0, "Custom maxCostUSD override is respected");
  assert(config.security?.maskPII === false, "Custom security.maskPII override is respected");
  assert(config.security?.outputDLP === true, "Un-overridden security.outputDLP default is preserved");
  assert(config.maxTokenBudget === 8192, "Un-overridden maxTokenBudget default is preserved");
};

const runAllPresetTests = async (): Promise<void> => {
  console.log("🚀 Testing AvantGate Launch-Safe Presets (FEAT-034)...");
  await runLaunchSafePresetTest();
  await runLaunchSafeRedactionTest();
  await runEnterpriseStrictPresetTest();
  await runDevPermissivePresetTest();
  await runCustomOverridesTest();
  console.log("\n🎉 All Presets tests passed successfully!");
};

runAllPresetTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
