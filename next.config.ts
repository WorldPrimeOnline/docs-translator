import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { withSentryConfig } from '@sentry/nextjs';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// Vercel preview toolbar (injected on Preview deployments, not in production).
const VERCEL_LIVE_DOMAINS = process.env.VERCEL_ENV !== 'production'
  ? ' https://vercel.live https://vercel.com'
  : '';

// Halyk ePay domains required for hosted payment page integration.
// Only the specific official domains are listed — no wildcard.
const HALYK_SCRIPT_DOMAINS = [
  'https://test-epay.epayment.kz',     // test payment script
  'https://epay.homebank.kz',           // production payment script
].join(' ');

const HALYK_CONNECT_DOMAINS = [
  'https://test-epay-oauth.epayment.kz',   // test OAuth
  'https://test-epay-api.epayment.kz',     // test API
  'https://epay-oauth.homebank.kz',         // production OAuth
  'https://epay-api.homebank.kz',           // production API
  'https://test-epay.epayment.kz',          // test form
  'https://epay.homebank.kz',               // production form
].join(' ');

const HALYK_FRAME_DOMAINS = [
  'https://test-epay.epayment.kz',
  'https://epay.homebank.kz',
].join(' ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    // X-Frame-Options replaced by frame-ancestors in CSP; kept for legacy browsers
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      `default-src 'self'`,
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${HALYK_SCRIPT_DOMAINS}${VERCEL_LIVE_DOMAINS}`,
      `style-src 'self' 'unsafe-inline'`,
      `img-src 'self' data: blob: https:`,
      `font-src 'self' data:`,
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://sentry.io ${HALYK_CONNECT_DOMAINS}`,
      `frame-src 'self' ${HALYK_FRAME_DOMAINS}`,
      `frame-ancestors 'self'`,
      `form-action 'self'`,
      `base-uri 'self'`,
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  trailingSlash: false,

  // Prevent webpack from bundling puppeteer-core (native bindings)
  serverExternalPackages: ['puppeteer-core'],

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default withSentryConfig(withNextIntl(nextConfig), {
  // Sentry org/project — read from env at build time if available
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Silent build output to keep CI logs clean
  silent: !process.env.CI,

  // Upload source maps to Sentry for readable stack traces
  widenClientFileUpload: true,

  // Automatically tree-shake Sentry logger statements in production
  disableLogger: true,

  // Don't automatically instrument Next.js server pages (we handle it via instrumentation.ts)
  autoInstrumentServerFunctions: false,
});
