/**
 * Fiscal provider configuration.
 * Server-side only.
 */

export type FiscalProviderName = 'manual' | 'webkassa';

export interface FiscalConfig {
  /** Whether automated fiscal receipt creation is enabled. false = pending_manual mode. */
  enabled: boolean;
  provider: FiscalProviderName;
  /** 'test' or 'production' — must match Halyk ePay provider_environment. */
  providerEnvironment: 'test' | 'production';
}

let _config: FiscalConfig | null = null;

export function getFiscalConfig(): FiscalConfig {
  if (_config) return _config;

  const rawProvider = process.env.FISCAL_PROVIDER ?? 'manual';
  const provider: FiscalProviderName = rawProvider === 'webkassa' ? 'webkassa' : 'manual';
  const enabled = process.env.FISCALIZATION_ENABLED === 'true' && provider !== 'manual';

  _config = {
    enabled,
    provider,
    providerEnvironment: process.env.FISCAL_PROVIDER_ENV === 'production' ? 'production' : 'test',
  };

  return _config;
}

export function _resetFiscalConfigCache(): void {
  _config = null;
}
