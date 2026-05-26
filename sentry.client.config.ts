import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Tracing
  tracesSampleRate: 0.2,

  // Session Replay — capture 10% of sessions, 100% on errors
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,

  // Don't log Sentry activity to console in production
  debug: false,

  integrations: [
    Sentry.replayIntegration({
      // Block PII from replay (document fields, etc.)
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
});
