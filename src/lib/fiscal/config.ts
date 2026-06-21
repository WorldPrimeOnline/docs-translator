/**
 * Fiscal provider configuration.
 * Server-side only.
 *
 * TODO (before production): set FISCAL_PROVIDER and FISCAL_PROVIDER_ENV, and add
 * the specific provider's credentials when the OFD/fiscal provider is confirmed.
 * Until then, FISCAL_PROVIDER defaults to 'manual' and all receipts are pending_manual.
 */

export type FiscalProviderName = 'manual';
// Future providers (add when credentials available): 'rekassa' | 'webkassa' | 'wofd'

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
  const enabled =
    process.env.FISCALIZATION_ENABLED === 'true' && rawProvider !== 'manual';

  _config = {
    enabled,
    provider: 'manual',  // Only manual is implemented. Real providers extend FiscalProvider.
    providerEnvironment: process.env.FISCAL_PROVIDER_ENV === 'production' ? 'production' : 'test',
  };

  return _config;
}

export function _resetFiscalConfigCache(): void {
  _config = null;
}
