/**
 * Fiscal provider factory.
 * Returns the configured provider adapter. Currently only 'manual' is implemented.
 * Server-side only.
 */
import { getFiscalConfig } from './config';
import { ManualFiscalProvider } from './manual-provider';
import type { FiscalProvider } from './types';

let _provider: FiscalProvider | null = null;

export function getFiscalProvider(): FiscalProvider {
  if (_provider) return _provider;

  const config = getFiscalConfig();

  // Only manual is implemented. Add real adapters here when provider is confirmed.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ = config.provider; // reference to document the intent

  _provider = new ManualFiscalProvider();
  return _provider;
}

export function _resetProviderCache(): void {
  _provider = null;
}
