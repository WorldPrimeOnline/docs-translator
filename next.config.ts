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

// Direct-to-R2 browser uploads (presigned PUT — src/lib/r2/client.ts getPresignedPutUrl)
// connect to the R2 bucket's own origin directly, bypassing this Next.js app entirely.
// Derived from the same server-side R2_ACCOUNT_ID/R2_BUCKET_NAME env vars the R2 client
// uses (never R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY — those never appear here), so each
// Vercel environment (staging Preview vs. production) automatically gets exactly its
// own bucket's origin in its own CSP — never the other environment's, never a wildcard.
// AWS SDK v3's S3Client (no forcePathStyle set) signs virtual-hosted-style URLs, i.e.
// https://{bucket}.{accountId}.r2.cloudflarestorage.com — must match that exactly.
const R2_UPLOAD_ORIGIN = process.env.R2_ACCOUNT_ID && process.env.R2_BUCKET_NAME
  ? `https://${process.env.R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  : '';

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
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://sentry.io ${HALYK_CONNECT_DOMAINS}${R2_UPLOAD_ORIGIN ? ` ${R2_UPLOAD_ORIGIN}` : ''}`,
      `frame-src 'self' ${HALYK_FRAME_DOMAINS}${VERCEL_LIVE_DOMAINS}`,
      `frame-ancestors 'self'`,
      `form-action 'self'`,
      `base-uri 'self'`,
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  trailingSlash: false,

  // Prevent webpack from bundling native-binding packages — webpack's bundling breaks their
  // native addon loading (puppeteer-core's Chromium binary; @napi-rs/canvas's platform-specific
  // .node binary, which pdf-parse/pdfjs-dist need for PDF text-layer extraction). Externalized
  // here so Node's own require() resolves them at runtime with native bindings intact, instead
  // of pdfjs-dist silently falling through to its browser code path (which references
  // DOMMatrix, undefined in any Node runtime) when webpack mangles the canvas addon — the exact
  // "ReferenceError: DOMMatrix is not defined" crash fixed 2026-07-24.
  //
  // serverExternalPackages only stops *webpack* from bundling these — it does nothing for
  // Vercel's separate @vercel/nft file-tracing step, which decides what actually ships in the
  // deployed function. Confirmed by inspecting the real trace file after a local `next build`
  // (.next/server/app/api/documents/upload-card/complete/route.js.nft.json): it contained 0
  // @napi-rs/canvas files. @napi-rs/canvas's index.js does a runtime-conditional require() of
  // one of ~10 optionalDependencies platform packages (e.g. @napi-rs/canvas-linux-x64-gnu) based
  // on process.platform/arch — nft's static analysis can't follow that branch, so the native
  // .node binary silently never made it into the deployed bundle even though webpack correctly
  // left the require() alone. outputFileTracingIncludes force-includes it for the two route
  // groups that reach analyzeDocumentForPricing()'s PDF branch (2026-07-25 fix).
  serverExternalPackages: ['puppeteer-core', 'pdf-parse', 'pdfjs-dist', '@napi-rs/canvas'],
  outputFileTracingIncludes: {
    '/api/documents/upload-card/**': [
      './node_modules/@napi-rs/canvas/**',
      './node_modules/@napi-rs/canvas-linux-x64-gnu/**',
    ],
    '/api/order-drafts/**': [
      './node_modules/@napi-rs/canvas/**',
      './node_modules/@napi-rs/canvas-linux-x64-gnu/**',
    ],
  },

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
