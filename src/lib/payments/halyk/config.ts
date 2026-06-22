/**
 * Centralised Halyk ePay configuration.
 * All endpoint URLs are derived here — never scattered across the codebase.
 * Production mode cannot be enabled accidentally: requires HALYK_EPAY_MODE=production
 * explicitly AND HALYK_EPAY_ENABLED=true.
 */

export type HalykMode = 'test' | 'production';

interface HalykEndpoints {
  oauthUrl: string;
  apiBase: string;
  scriptUrl: string;
}

const TEST_ENDPOINTS: HalykEndpoints = {
  oauthUrl: 'https://test-epay-oauth.epayment.kz/oauth2/token',
  apiBase: 'https://test-epay-api.epayment.kz',
  scriptUrl: 'https://test-epay.epayment.kz/payform/payment-api.js',
};

const PROD_ENDPOINTS: HalykEndpoints = {
  oauthUrl: 'https://epay-oauth.homebank.kz/oauth2/token',
  apiBase: 'https://epay-api.homebank.kz',
  scriptUrl: 'https://epay.homebank.kz/payform/payment-api.js',
};

export interface HalykConfig {
  enabled: boolean;
  mode: HalykMode;
  clientId: string;
  clientSecret: string;
  terminalId: string;
  appBaseUrl: string;
  endpoints: HalykEndpoints;
}

function resolveMode(raw: string | undefined): HalykMode {
  if (raw === 'production') return 'production';
  return 'test';
}

/**
 * Lazily resolved configuration. Reads environment variables at runtime, not at
 * module import time, so the build phase does not require live env vars.
 */
let _config: HalykConfig | null = null;

export function getHalykConfig(): HalykConfig {
  if (_config) return _config;

  const mode = resolveMode(process.env.HALYK_EPAY_MODE);
  const enabled =
    process.env.HALYK_EPAY_ENABLED === 'true' &&
    !!process.env.HALYK_EPAY_CLIENT_ID &&
    !!process.env.HALYK_EPAY_CLIENT_SECRET &&
    !!process.env.HALYK_EPAY_TERMINAL_ID;

  _config = {
    enabled,
    mode,
    clientId: process.env.HALYK_EPAY_CLIENT_ID ?? '',
    clientSecret: process.env.HALYK_EPAY_CLIENT_SECRET ?? '',
    terminalId: process.env.HALYK_EPAY_TERMINAL_ID ?? '',
    appBaseUrl: (process.env.APP_BASE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, ''),
    endpoints: mode === 'production' ? PROD_ENDPOINTS : TEST_ENDPOINTS,
  };

  return _config;
}

/** For tests: reset cached config so env vars are re-read. */
export function _resetConfigCache(): void {
  _config = null;
}
