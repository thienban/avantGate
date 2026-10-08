import type { ControlLayerConfig, ProviderConfig, SecurityConfig, RetryConfig } from "./types";

export interface PresetBaseOptions extends Partial<ControlLayerConfig> {
  primary: ProviderConfig;
}

export const createLaunchSafeConfig = (options: PresetBaseOptions): ControlLayerConfig => {
  const defaultSecurity: SecurityConfig = {
    detectPromptInjection: true,
    maskPII: true,
    outputDLP: true,
    blockSecretLeaks: true,
    secretLeakAction: "REDACT",
  };
  const defaultRetries: RetryConfig = { maxRetries: 2, initialDelayMs: 300, backoffFactor: 1.5 };
  return {
    maxTokenBudget: 8192,
    maxCostUSD: 0.5,
    ...options,
    retryOptions: { ...defaultRetries, ...options.retryOptions },
    security: { ...defaultSecurity, ...options.security },
  };
};

export const createEnterpriseStrictConfig = (options: PresetBaseOptions): ControlLayerConfig => {
  const defaultSecurity: SecurityConfig = {
    detectPromptInjection: true,
    maskPII: true,
    outputDLP: true,
    blockSecretLeaks: true,
    secretLeakAction: "BLOCK",
  };
  const defaultRetries: RetryConfig = {
    maxRetries: 3,
    initialDelayMs: 500,
    backoffFactor: 2.0,
  };
  return {
    maxTokenBudget: 4096,
    maxCostUSD: 0.15,
    ...options,
    retryOptions: { ...defaultRetries, ...options.retryOptions },
    security: { ...defaultSecurity, ...options.security },
  };
};

export const createDevPermissiveConfig = (options: PresetBaseOptions): ControlLayerConfig => {
  const defaultSecurity: SecurityConfig = {
    detectPromptInjection: false,
    maskPII: false,
    outputDLP: false,
    blockSecretLeaks: false,
  };
  const defaultRetries: RetryConfig = {
    maxRetries: 1,
    initialDelayMs: 200,
    backoffFactor: 1.0,
  };
  return {
    ...options,
    retryOptions: { ...defaultRetries, ...options.retryOptions },
    security: { ...defaultSecurity, ...options.security },
  };
};

export const PRESETS = {
  LAUNCH_SAFE: createLaunchSafeConfig,
  ENTERPRISE_STRICT: createEnterpriseStrictConfig,
  DEV_PERMISSIVE: createDevPermissiveConfig,
};
