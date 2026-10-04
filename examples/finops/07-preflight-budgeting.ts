import { createAvantGate, BudgetExceededError } from "avantgate";

export const runPreflightBudgetExample = async (): Promise<void> => {
  const gate = createAvantGate({
    primary: {
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: process.env.DEEPSEEK_API_KEY || "mock-key",
    },
    maxTokenBudget: 500, // Maximum allowed tokens
    maxCostUSD: 0.005,   // Maximum allowed USD spend ($0.005)
  });

  try {
    await gate.execute({
      userQuery: "Perform full compliance and forensic audit on this 100-page document...",
    });
  } catch (error) {
    if (error instanceof BudgetExceededError) {
      console.warn("🛑 Budget Exceeded Pre-Flight:", error.message);
    }
  }
};
