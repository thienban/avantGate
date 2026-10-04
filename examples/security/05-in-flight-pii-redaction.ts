import { createAvantGate } from "avantgate";

export const runPiiRedactionExample = async (): Promise<void> => {
  const gate = createAvantGate({
    primary: {
      provider: "deepseek",
      model: "deepseek-chat",
      apiKey: process.env.DEEPSEEK_API_KEY || "mock-key",
    },
    security: {
      maskPII: true,
    },
  });

  // Automatically detects and masks sensitive data before outbound request
  const response = await gate.execute({
    userQuery:
      "Please process the refund for Alice Dupont (NIR: 185057501234567, IBAN: FR7630006000011234567890189, email: alice@company.fr).",
  });

  console.log("Secure Sanitized Execution Complete:", response.text);
};
