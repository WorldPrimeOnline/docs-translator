/**
 * Fiscal provider factory.
 * Returns the configured provider adapter.
 * Server-side only.
 *
 * FISCAL_PROVIDER=manual   → ManualFiscalProvider (safe default, pending_manual receipts)
 * FISCAL_PROVIDER=webkassa → WebkassaFiscalProvider (real OFD integration via Webkassa API v4)
 */
import { getFiscalConfig } from './config';
import { ManualFiscalProvider } from './manual-provider';
import { WebkassaFiscalProvider } from './webkassa-provider';
import type { FiscalProvider } from './types';

let _provider: FiscalProvider | null = null;

export function getFiscalProvider(): FiscalProvider {
  if (_provider) return _provider;

  const config = getFiscalConfig();

  switch (config.provider) {
    case 'webkassa':
      _provider = new WebkassaFiscalProvider();
      break;
    case 'manual':
    default:
      _provider = new ManualFiscalProvider();
      break;
  }

  return _provider;
}

export function _resetProviderCache(): void {
  _provider = null;
}
