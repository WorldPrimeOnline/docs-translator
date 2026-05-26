import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,

  // 20% of transactions traced — avoids Sentry quota burn
  tracesSampleRate: 0.2,

  debug: false,
});
