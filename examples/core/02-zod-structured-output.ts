import { createAvantGate } from "avantgate";
import { z } from "zod";

const CompanyFinancialsSchema = z.object({
  company: z.string(),
  revenueUSD: z.number(),
  growthScore: z.number(),
});

export const runStructuredOutputExample = async (): Promise<void> => {
  const gate = createAvantGate({
    primary: {
      provider: "mistral",
      model: "mistral-small-latest",
      apiKey: process.env.MISTRAL_API_KEY || "mock-key",
    },
  });

  const response = await gate.generateStructuredOutput({
    schema: CompanyFinancialsSchema,
    prompt: "Extract financial metrics: Acme Corp recorded $12.5M in revenue with a growth score of 88.",
  });

  console.log("Structured Company:", response.data.company);
  console.log("Revenue USD:", response.data.revenueUSD);
  console.log("Growth Score:", response.data.growthScore);
};
