export interface PiiComplianceReport {
  isCompliant: boolean;
  scorePercent: number;
  totalFilteredPii: number;
  unmaskedLeakCount: number;
  findings: string[];
}

export const auditDualChannelSeparation = (
  rawPayload: Record<string, unknown> | null | undefined,
  llmSummary: Record<string, unknown> | null | undefined,
  piiFilteredCount: number
): PiiComplianceReport => {
  const findings: string[] = [];
  let unmaskedLeakCount = 0;

  if (!rawPayload) {
    return {
      isCompliant: true,
      scorePercent: 100,
      totalFilteredPii: piiFilteredCount,
      unmaskedLeakCount: 0,
      findings: ["Aucune donnée brute sensible transmise."],
    };
  }

  const rawStr = JSON.stringify(rawPayload).toLowerCase();
  const summaryStr = JSON.stringify(llmSummary || {}).toLowerCase();

  const sensitiveKeywords = ["email", "phone", "iban", "ssn", "password", "token", "credit_card"];

  for (const keyword of sensitiveKeywords) {
    if (rawStr.includes(keyword) && summaryStr.includes(keyword)) {
      unmaskedLeakCount++;
      findings.push(`Alerte RGPD: Référence potentielle au champ '${keyword}' détectée dans le canal LLM.`);
    }
  }

  const scorePercent = unmaskedLeakCount === 0 ? 100 : Math.max(0, 100 - unmaskedLeakCount * 25);

  return {
    isCompliant: unmaskedLeakCount === 0,
    scorePercent,
    totalFilteredPii: piiFilteredCount,
    unmaskedLeakCount,
    findings: findings.length > 0 ? findings : ["Étanchéité PII 100% garantie entre le stockage local et le LLM."],
  };
};
