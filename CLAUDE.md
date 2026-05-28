# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read First

Always read `PROJECT_CONTEXT.md` at the start of every session. It is the authoritative source for product vision, positioning rules, business constraints, and MVP status. Do not reposition this product as a generic AI translator.

---

## Commands

### Web app (`/`)
```bash
npm run dev       # Start Next.js dev server
npm run build     # Production build
npm run lint      # ESLint
```

### Worker (`/worker`)
```bash
cd worker
npm run dev       # tsx watch src/index.ts (hot-reload)
npm run build     # tsc → dist/
npm run start     # node dist/index.js (production)
```

There are no automated tests in this repo.

---

## Architecture

### Two separate services

**Web app** (`src/`) — Next.js 15 App Router on Vercel  
**Worker** (`worker/`) — standalone Node.js service on Railway, deployed via Docker (`worker/Dockerfile`)

They share the same Supabase database and Cloudflare R2 bucket but have independent `package.json`, `tsconfig.json`, and env sets.

### Routing

All user-facing pages live under `src/app/[locale]/`. The `[locale]` segment is handled by `next-intl` via `src/middleware.ts`. English (`en`) uses no URL prefix; all other locales prefix with `/{locale}`.

Supported locales: `en ru zh ko kk tj uz tk mn ky es` (defined in `src/i18n/routing.ts`).

Auth guards live in middleware: unauthenticated users are redirected to `/{locale}/auth/login` when hitting `/dashboard`; logged-in users are redirected away from auth pages.

### Landing page system

Landing pages are config-driven. Every vertical/document page instantiates `<LandingPage config={...} />` (`src/components/landing/LandingPage.tsx`) with a typed `LandingPageConfig` object (`src/lib/landing-pages/types.ts`). Page-specific data lives in `src/lib/landing-pages/{thailand,kazakhstan,documents,shared}.ts`. Do not duplicate section components — extend the config type instead.

### Worker pipeline

`worker/src/index.ts` polls Supabase every 10s for `jobs` rows with `status = 'queued'`. Payment eligibility is checked before processing: `payment_source = 'subscription'` is immediately eligible; `payment_source = 'ton_payment'` requires a completed `ton_payments` row. The pipeline in `worker/src/processor.ts`:

1. Download PDF from R2 (`worker/src/lib/r2.ts`)
2. OCR via Mistral API (`worker/src/lib/ocr.ts`)
3. Translate via Claude Sonnet 4.6 (`worker/src/lib/translator.ts`)
4. Render HTML template (`worker/src/lib/renderer.ts`)
5. Generate PDF via puppeteer-core + `@sparticuz/chromium` (`worker/src/lib/pdf.ts`)
6. Upload result to R2, update `translations` row, send email via Resend (`worker/src/lib/email.ts`)

### Payments

TON-only today. Webhook at `/api/webhooks/ton` routes by memo UUID to either a subscription or pay-per-doc job. Subscription state lives in the `subscriptions` table. Pay-per-doc state lives in `ton_payments`. Stripe is planned but not implemented — do not add Stripe code without being asked.

### Database tables (Supabase)

`users`, `documents`, `jobs` (queue), `translations` (OCR text + output R2 key), `ton_payments`, `subscriptions`

### i18n

Translation strings: `messages/{locale}.json`. All 11 locale files must be kept in sync. Add new keys to `en.json` first, then propagate to all other locales.

### env validation

Web app: `src/lib/env.ts` (Zod, lazy-validated proxy)  
Worker: `worker/src/lib/env.ts`  
Do not add new env vars beyond those listed in `PROJECT_CONTEXT.md § 15`.

### shadcn/ui

Config: `components.json`. Style: `base-nova`. Uses `@base-ui/react` (not `@radix-ui/react`). Only `@radix-ui/react-slot` is retained. Add components with `npx shadcn add <component>`.

### Sentry

Three config files at root: `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`. Instrumentation entry at `src/instrumentation.ts`. Global error boundary at `src/app/global-error.tsx`.

---

## Code standards

- TypeScript strict mode everywhere; explicit return types on async functions
- Zod for runtime validation: env vars, LLM output, API boundaries
- All LLM calls must use retry logic with exponential backoff, max 3 retries
- Server actions for mutations; API routes only when needed (e.g. webhooks, cron)
- Never expose secrets to the client bundle
- Conventional commits
