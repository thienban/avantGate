import { z } from "zod";

export const TimestampSchema = z.iso.datetime();
export type Timestamp = z.infer<typeof TimestampSchema>;

export const TokenUsageSchema = z.object({
  promptTokens: z.number().nonnegative().default(0),
  completionTokens: z.number().nonnegative().default(0),
  totalTokens: z.number().nonnegative().default(0),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const StepStartEventSchema = z.object({
  type: z.literal("STEP_START"),
  stepName: z.string().min(1),
  timestamp: TimestampSchema,
});
export type StepStartEvent = z.infer<typeof StepStartEventSchema>;

export const ToolExecutionEventSchema = z.object({
  type: z.literal("TOOL_EXECUTION"),
  toolId: z.string().min(1),
  toolName: z.string().min(1),
  aliasUsed: z.string().nullable().optional(),
  parentToolId: z.string().nullable().optional(),
  depth: z.number().nonnegative().default(1),
  durationMs: z.number().nonnegative().default(0),
  success: z.boolean().default(true),
  attempts: z.number().int().positive().optional(),
  maxRetries: z.number().int().nonnegative().optional(),
  retriedErrors: z.array(z.string()).optional(),
  llmSummary: z.record(z.string(), z.unknown()).nullable().optional(),
  rawPayload: z.record(z.string(), z.unknown()).nullable().optional(),
  piiFilteredCount: z.number().nonnegative().default(0),
  tokens: TokenUsageSchema.optional(),
  costUsd: z.number().nonnegative().default(0),
  cached: z.boolean().default(false),
  timestamp: TimestampSchema,
});
export type ToolExecutionEvent = z.infer<typeof ToolExecutionEventSchema>;

export const StepCompletedEventSchema = z.object({
  type: z.literal("STEP_COMPLETED"),
  stepName: z.string().min(1),
  durationMs: z.number().nonnegative().default(0),
  piiDetectedCount: z.number().nonnegative().default(0),
  resultSummary: z.record(z.string(), z.unknown()).nullable().optional(),
  timestamp: TimestampSchema,
});
export type StepCompletedEvent = z.infer<typeof StepCompletedEventSchema>;

export const StepFailedEventSchema = z.object({
  type: z.literal("STEP_FAILED"),
  stepName: z.string().min(1),
  durationMs: z.number().nonnegative().optional(),
  error: z.string().default("Unknown error"),
  timestamp: TimestampSchema,
});
export type StepFailedEvent = z.infer<typeof StepFailedEventSchema>;

export const StepApprovalRequestEventSchema = z.object({
  type: z.literal("STEP_APPROVAL_REQUEST"),
  stepName: z.string().min(1),
  actionType: z.string().min(1),
  payloadSummary: z.record(z.string(), z.unknown()).default({}),
  timestamp: TimestampSchema,
});
export type StepApprovalRequestEvent = z.infer<typeof StepApprovalRequestEventSchema>;

export const LlmGenerationEventSchema = z.object({
  type: z.literal("LLM_GENERATION"),
  model: z.string().default("gpt-4o-mini"),
  systemPrompt: z.string().optional(),
  userPrompt: z.string().min(1),
  completionText: z.string().default(""),
  promptTokens: z.number().nonnegative().default(0),
  completionTokens: z.number().nonnegative().default(0),
  cachedPromptTokens: z.number().nonnegative().default(0),
  durationMs: z.number().nonnegative().default(0),
  ttftMs: z.number().nonnegative().optional(),
  costUsd: z.number().nonnegative().default(0),
  timestamp: TimestampSchema,
});
export type LlmGenerationEvent = z.infer<typeof LlmGenerationEventSchema>;

export const ClientDataRenderedEventSchema = z.object({
  type: z.literal("CLIENT_DATA_RENDERED"),
  toolId: z.string().min(1),
  channel: z.enum(["SOCKET", "STREAM", "HTTP"]).default("HTTP"),
  renderedItemCount: z.number().nonnegative().optional(),
  timestamp: TimestampSchema,
});
export type ClientDataRenderedEvent = z.infer<typeof ClientDataRenderedEventSchema>;

export const ClientSecurityAlertEventSchema = z.object({
  type: z.literal("CLIENT_SECURITY_ALERT"),
  alertType: z.enum(["POTENTIAL_PROMPT_INJECTION", "SUSPECTED_SECRET_INPUT", "SUSPECTED_PII_INPUT"]),
  inputLength: z.number().nonnegative(),
  matchedPatternSnippet: z.string().optional(),
  snippet: z.string().optional(),
  timestamp: TimestampSchema,
});
export type ClientSecurityAlertEvent = z.infer<typeof ClientSecurityAlertEventSchema>;

export const UserFeedbackEventSchema = z.object({
  type: z.literal("USER_FEEDBACK"),
  rating: z.enum(["POSITIVE", "NEGATIVE"]),
  feedbackTag: z.enum(["HELPFUL", "INACCURATE", "UNSAFE", "OFF_TOPIC"]).optional(),
  userComment: z.string().max(500).optional(),
  timestamp: TimestampSchema,
});
export type UserFeedbackEvent = z.infer<typeof UserFeedbackEventSchema>;

export const RunEventSchema = z.discriminatedUnion("type", [
  StepStartEventSchema,
  ToolExecutionEventSchema,
  StepCompletedEventSchema,
  StepFailedEventSchema,
  StepApprovalRequestEventSchema,
  LlmGenerationEventSchema,
  ClientDataRenderedEventSchema,
  ClientSecurityAlertEventSchema,
  UserFeedbackEventSchema,
]);
export type RunEvent = z.infer<typeof RunEventSchema>;

export const OverallUsageSchema = z.object({
  model: z.string().default("gpt-4o-mini"),
  promptTokens: z.number().nonnegative().default(0),
  completionTokens: z.number().nonnegative().default(0),
  totalTokens: z.number().nonnegative().default(0),
  costUsd: z.number().nonnegative().default(0),
});
export type OverallUsage = z.infer<typeof OverallUsageSchema>;

export const SessionMetadataSchema = z
  .object({
    retryOf: z.string().optional(),
    replayedBy: z.string().optional(),
    tenantId: z.string().optional(),
    taskId: z.string().optional(),
  })
  .catchall(z.unknown())
  .optional();
export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

export const TelemetryIngestPayloadSchema = z.object({
  runId: z
    .string()
    .min(1)
    .default(() => `run_client_${Date.now()}`),
  agentName: z.string().min(1),
  tenantId: z.string().optional(),
  taskId: z.string().optional(),
  timestamp: TimestampSchema,
  events: z.array(RunEventSchema),
  usage: OverallUsageSchema.optional(),
  metadata: SessionMetadataSchema,
});
export type TelemetryIngestPayload = z.infer<typeof TelemetryIngestPayloadSchema>;

export type SessionStatus =
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "WAITING_APPROVAL"
  | "RETRYING"
  | "RECOVERED";

export interface SessionRun {
  id: string;
  runId: string;
  agentName: string;
  tenantId?: string;
  taskId?: string;
  status: SessionStatus;
  startTime: string;
  endTime?: string;
  durationMs: number;
  totalCostUsd: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  model: string;
  eventsCount: number;
  toolsUsedCount: number;
  piiFilteredCount: number;
  loopAlertTriggered: boolean;
  clientSecurityAlertsCount: number;
  clientDataRenderedCount: number;
  hasRetriesOccurred?: boolean;
  attempts?: number;
  maxRetries?: number;
  retriedErrors?: string[];
  retryOf?: string;
  replayedBy?: string;
  metadata?: {
    retryOf?: string;
    replayedBy?: string;
    tenantId?: string;
    taskId?: string;
    attempts?: number;
    maxRetries?: number;
    [key: string]: unknown;
  };
  userFeedback?: {
    rating: "POSITIVE" | "NEGATIVE";
    tag?: string;
    comment?: string;
  };
  events: RunEvent[];
}

export interface ApprovalItem {
  id: string;
  runId: string;
  agentName: string;
  stepName: string;
  actionType: string;
  payloadSummary: Record<string, unknown>;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  reason?: string;
}

export interface ToolHealthMetric {
  toolName: string;
  totalExecutions: number;
  successRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  totalCostUsd: number;
  loopShieldTriggers: number;
  lastUsedAt: string;
}

export interface FinOpsSummary {
  totalCostUsd: number;
  totalTokens: number;
  totalRuns: number;
  activeAgentsCount: number;
  costByModel: Record<string, { costUsd: number; tokens: number; count: number }>;
  dailyHistory: Array<{ date: string; costUsd: number; tokens: number; runs: number }>;
}

export const FirewallDecisionSchema = z.enum([
  "PASS",           // Donnée conforme, exécution autorisée
  "REDACT",         // Donnée conforme après masquage local PII/Secret
  "FLAG_FOR_HUMAN", // Action sensible suspendue pour approbation
  "BLOCK",          // Violation critique, mise en quarantaine immédiate
]);
export type FirewallDecision = z.infer<typeof FirewallDecisionSchema>;

export const IngressValidationResultSchema = z.object({
  isValid: z.boolean(),
  decision: FirewallDecisionSchema,
  sanitizedInput: z.unknown(),
  injectionRiskScore: z.number().min(0).max(100),
  violations: z.array(z.string()),
});
export type IngressValidationResult = z.infer<typeof IngressValidationResultSchema>;

export const EgressValidationResultSchema = z.object({
  isValid: z.boolean(),
  decision: FirewallDecisionSchema,
  sanitizedOutput: z.unknown(),
  dleiScore: z.number().min(0).max(100),
  redactedEntitiesCount: z.number().int().min(0),
  strippedContextItems: z.array(z.string()),
  violations: z.array(z.string()),
});
export type EgressValidationResult = z.infer<typeof EgressValidationResultSchema>;

export interface DataLineageProof {
  toolId: string;
  toolName: string;
  sourceType: "DATABASE" | "CRM" | "API" | "INTERNAL_DOCS";
  totalFieldsExtracted: number;
  piiFieldsDetected: Array<{ fieldName: string; piiType: string }>;
  rawPayloadHash: string;
  sanitizedSummaryHash: string;
  leakDetectedInPrompt: boolean;
  leakExposureRatio: number;
  complianceStatus: "COMPLIANT_ZERO_LEAK" | "POTENTIAL_EXPOSURE" | "CRITICAL_BREACH";
  certifiedTimestamp: string;
}

export interface DpoComplianceCertificate {
  certificateId: string;
  runId: string;
  agentName: string;
  issuedAt: string;
  frameworkStandard: "RGPD_EU_2016_679" | "HIPAA_SECURITY_RULE" | "AI_ACT_LEVEL_HIGH";
  auditScore: number;
  totalPiiIsolated: number;
  unmaskedLeakCount: number;
  dataLineageProofs: DataLineageProof[];
  cisoRecommendation: string;
  digitalSignature: string;
}
