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

### Upload flow

`POST /api/documents/upload` accepts PDF, PNG, JPG, or DOCX (max 25 MB). Non-PDF files are converted to PDF in-process via `src/lib/convert-to-pdf.ts` (pdf-lib + sharp for images, mammoth for DOCX) before uploading to R2. Additional optional fields: `country`, `notarized`, `bureauStamp`, `outputFormat`.

### Dual job processor architecture

There are **two separate processors** — do not conflate them.

**Web app processor** (`src/lib/jobs/processor.ts`):
- Called via `setTimeout(() => void processJob(...), 0)` from the upload route for **subscription jobs only** (`payment_source: 'subscription'`)
- Runs on Vercel (no Puppeteer): OCR → translate → `renderToPdf` (which despite the name produces an HTML document, not a browser PDF) → saves `.html` to R2 → inserts into `translations`
- Uses `src/lib/ocr/mistral.ts`, `src/lib/translation/translator.ts`, `src/lib/pdf/renderer.ts`

**Railway worker** (`worker/src/processor.ts`):
- Claims jobs atomically via `UPDATE WHERE status='queued'` — prevents double-processing
- Polls Supabase every 10 s for unclaimed `status = 'queued'` jobs — handles both subscription and pay-per-doc
- OCR quality gate: aborts early if extracted text is below minimum word/char threshold (saves translation credits)
- Full pipeline: OCR → translate → render HTML → **Puppeteer PDF** → upload `.pdf` to R2 → upsert `translations` → email
- If Puppeteer fails, falls back to saving `.html`
- On completion it upserts the `translations` row (handles race with the Vercel processor)

Both processors use `claude-sonnet-4-5-20250929` via `@anthropic-ai/sdk` (constant `MODEL` in each `translator.ts`).

### Job status flow

`queued → ocr_in_progress → ocr_completed → translation_in_progress → pdf_rendering → completed | failed`

Each transition also updates `progress_percent` (0–100).

### Estimate API

`POST /api/documents/estimate` — OCRs the already-uploaded PDF via Mistral, counts words, and returns a dynamic price. Caches result in `documents.word_count` / `documents.price_usd`. Pricing: `$0.01 × wordCount + $10 (notarized, KZ only) + $5 (bureau_stamp, KZ only)`.

Flat-rate TON prices (pay-per-doc, no OCR) live in `src/lib/ton/config.ts`: $4.39 for passport/driver_license, $4.99 otherwise.

### Landing page system

Landing pages are config-driven. Every vertical/document page instantiates `<LandingPage config={...} />` (`src/components/landing/LandingPage.tsx`) with a typed `LandingPageConfig` object (`src/lib/landing-pages/types.ts`). Page-specific data lives in `src/lib/landing-pages/{thailand,kazakhstan,documents,shared}.ts`. Do not duplicate section components — extend the config type instead.

### Legal system

7 document types: `offer`, `privacy`, `personal-data-consent`, `refund-policy`, `disclaimer`, `terms`, `partners`. Types/slugs defined in `src/lib/legal/types.ts`. Content per locale in `src/lib/legal/content/{locale}.ts` (11 locales). Rendered at `[locale]/legal/[slug]` via `src/app/[locale]/legal/[slug]/page.tsx`. Aliases `/privacy` and `/tos` point to the appropriate slug.

### Payments

TON-only today. Stripe is planned but not implemented — do not add Stripe code without being asked.

Pay-per-doc flow: `POST /api/payments/create-ton-payment` → user pays → `POST /api/payments/verify-ton-payment` (polls tonapi.io) → `POST /api/webhooks/ton` (tonconsole webhook, routes by memo UUID to subscription or job).

Subscription flow: `POST /api/subscriptions/create` → user pays TON → webhook activates subscription → upload route calls `POST /api/subscriptions/use-document` to decrement quota.

TON price fetched at upload time from CoinGecko (`src/lib/ton/price.ts`). Subscription state: `subscriptions` table. Pay-per-doc state: `ton_payments` table.

### Database tables (Supabase)

| Table | Key columns |
|---|---|
| `users` | auth users |
| `documents` | `file_key`, `source_language`, `target_language`, `document_type`, `output_format`, `status`, `word_count`, `price_usd` |
| `jobs` | `status`, `progress_percent`, `priority`, `payment_source`, `country`, `notarized`, `bureau_stamp` |
| `ocr_results` | `job_id`, `markdown`, `page_count`, `provider` |
| `translations` | `job_id`, `translated_markdown`, `translated_pdf_key` |
| `ton_payments` | pay-per-doc TON transactions |
| `subscriptions` | `plan`, `status`, `documents_used`, `documents_limit`, `expires_at` |

### API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/documents/upload` | Upload + (for subscriptions) kick off web processor |
| POST | `/api/documents/estimate` | OCR + word-count pricing, cached in `documents` |
| GET | `/api/documents/[documentId]/download` | Presigned R2 URL for the translated file |
| GET | `/api/jobs/[jobId]` | Job status polling (used by dashboard) |
| GET | `/api/payments/ton-price` | Live TON/USD rate from CoinGecko |
| POST | `/api/payments/create-ton-payment` | Create pending pay-per-doc TON payment |
| POST | `/api/payments/verify-ton-payment` | Poll tonapi.io to confirm payment landed |
| POST | `/api/payments/link-wallet` | Associate TON wallet address with user |
| POST | `/api/subscriptions/create` | Create a pending subscription |
| GET | `/api/subscriptions/current` | Active subscription for the current user |
| POST | `/api/subscriptions/use-document` | Decrement subscription quota by 1 |
| POST | `/api/webhooks/ton` | tonconsole webhook — activates payment/subscription |
| GET | `/api/cron/cleanup` | Daily 02:00 UTC — deletes files older than 30 days (secured via `CRON_SECRET`) |

### Rate limiting

**Middleware** (`src/middleware.ts`): in-memory per-IP limiter (per Vercel instance, not globally shared). Upload-adjacent paths: 10 req/min. Job-polling paths: 120 req/min.

**Upload route**: additional per-user limit of 10 uploads/hour enforced in the handler.

### i18n

Translation strings: `messages/{locale}.json`. All 11 locale files must be kept in sync. Add new keys to `en.json` first, then propagate to all other locales.

### Supabase client split

- `src/lib/supabase/client.ts` — browser client (anon key)
- `src/lib/supabase/server.ts` — server client with service role key (for API routes and server components)

### env validation

Web app: `src/lib/env.ts` (Zod, lazy-validated proxy)  
Worker: `worker/src/lib/env.ts`  
Do not add new env vars beyond those listed in `PROJECT_CONTEXT.md § 15`.

`CRON_SECRET` is required on Vercel for the cleanup cron job but is omitted from §15 — it must be set in the Vercel dashboard and matched against the `Authorization: Bearer <secret>` header sent by the Vercel cron scheduler.

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
