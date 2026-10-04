import { createAvantGate } from "avantgate";

export const runFailoverExample = async (): Promise<void> => {
  const gate = createAvantGate({
    primary: {
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: process.env.DEEPSEEK_API_KEY || "mock-key",
    },
    fallback: {
      provider: "mistral",
      model: "mistral-small-latest",
      apiKey: process.env.MISTRAL_API_KEY || "mock-key",
    },
    emergencyFallback: {
      provider: "ollama",
      model: "llama3.2:latest",
      baseUrl: "http://localhost:11434/v1",
    },
  });

  const response = await gate.execute({
    userQuery: "Analyze macroeconomic trends for Q3.",
  });

  console.log(`Executed on: ${response.modelUsed} (Failover occurred: ${response.failoverOccurred})`);
};
