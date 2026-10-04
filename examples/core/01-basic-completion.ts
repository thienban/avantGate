import { createAvantGate } from "avantgate";

export const runBasicCompletionExample = async (): Promise<void> => {
  const gate = createAvantGate({
    primary: {
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: process.env.DEEPSEEK_API_KEY || "mock-key",
    },
  });

  const result = await gate.execute({
    systemPrompt: "You are a concise financial assistant.",
    userQuery: "Summarize EBITDA vs Operating Income in 2 sentences.",
  });

  console.log("Response:", result.text);
  console.log(`Cost: $${result.costUSD.toFixed(6)} (${result.tokens.total} tokens)`);
};
