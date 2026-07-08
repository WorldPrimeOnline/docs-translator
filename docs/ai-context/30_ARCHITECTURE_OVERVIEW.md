# Architecture Overview

## Two separate services

**Web app** (`src/`) — Next.js 15 App Router on Vercel
**Worker** (`worker/`) — standalone Node.js service on Railway, deployed via Docker (`worker/Dockerfile`)

They share the same Supabase database and Cloudflare R2 bucket but have independent `package.json`, `tsconfig.json`, and env sets.

## Routing

All user-facing pages live under `src/app/[locale]/`. The `[locale]` segment is handled by `next-intl` via `src/middleware.ts`. English (`en`) uses no URL prefix; all other locales prefix with `/{locale}`.

Supported locales: `en ru zh ko kk tj uz tk mn ky es` (defined in `src/i18n/routing.ts`).

Auth guards live in middleware: unauthenticated users are redirected to `/{locale}/auth/login` when hitting `/dashboard`; logged-in users are redirected away from auth pages.

## Upload flow

`POST /api/documents/upload` accepts one or more PDF, PNG, JPG, or DOCX files. Each file is capped at 25 MB; total payload at 50 MB. Multiple files are individually converted to PDF then merged via `mergePdfs()` in `src/lib/convert-to-pdf.ts` before uploading as a single R2 object. Additional optional fields: `country`, `notarized`, `bureauStamp`, `outputFormat`.

## document_type column encoding

`documents.document_type` stores a compound string `"{type}|{format}"` (e.g., `"passport_id|pdf"`, `"diploma_transcript|docx"`). Both processors call `parseDocumentType()` to split on `|` — the suffix drives output: `pdf` → Puppeteer PDF, `docx` → DOCX renderer, anything else (or no suffix) → HTML. Do not write raw document type keys without checking whether an output format suffix is expected.

Legacy key aliases (`passport` → `passport_id`, `diploma` → `diploma_transcript`, `medical` → `medical_document`, `employment` → `employment_document`) are normalised via `normalizeDocumentType()` in `src/lib/translation-prompts/index.ts`.

## Dual job processor architecture

There are **two separate processors** — do not conflate them.

**Web app processor** (`src/lib/jobs/processor.ts`):
- Called via `setTimeout(() => void processJob(...), 0)` from the upload route for **subscription jobs with `html` output only** — jobs with `pdf` or `docx` output format are left queued for the Railway worker even on the subscription path
- Runs on Vercel (no Puppeteer): OCR → translate → `renderToPdf` (which despite the name produces an HTML document, not a browser PDF) → saves `.html` to R2 → inserts into `translations`
- Uses `src/lib/ocr/mistral.ts`, `src/lib/translation/translator.ts`, `src/lib/pdf/renderer.ts`

**Railway worker** (`worker/src/processor.ts`):
- Claims jobs atomically via `UPDATE WHERE status='queued'` — prevents double-processing
- Polls Supabase every 10 s for unclaimed `status = 'queued'` jobs — handles both subscription and pay-per-doc
- **Payment eligibility gate** (`isEligible()` in `worker/src/index.ts`): subscription jobs are eligible immediately; card_payment jobs must have a `paid` or `completed` row in `payment_transactions` before the worker starts processing. Jobs that fail the gate are skipped silently until a payment arrives.
- **Graceful shutdown**: handles SIGTERM/SIGINT with up to 120 s for in-flight jobs to complete before `process.exit(0)`.
- OCR quality gate: aborts early if extracted text is below minimum word/char threshold (saves translation credits)
- Calls `computeOutputPlan(job.service_level ?? job.notarized)` to determine artifact path: `translation_only` (immediate PDF release) or `translator_review_draft` (DOCX + preview PDF, `workflow_status: awaiting_translator_review`). Pass `service_level` — the boolean `notarized` is a legacy fallback for pre-migration rows.
- If Puppeteer fails, falls back to saving `.html`
- Supports DOCX output via `worker/src/lib/docx-renderer.ts` (also in web app at `src/lib/pdf/docx-renderer.ts`)
- Full step-by-step call graph for the official/notarized pipeline path: `docs/OFFICIAL_TRANSLATION_PIPELINE.md`
- `translateToAst()` is called non-blockingly after translation for background AST enrichment; result stored in `translations.translated_ast` but **never** used for rendering — the AST renderer (`worker/src/lib/ast/`) is wired for future opt-in only

Both processors use `claude-sonnet-4-5-20250929` via `@anthropic-ai/sdk` (constant `MODEL` in each file). There are **five** `MODEL` constants to update when changing the model: `src/lib/translation/translator.ts`, `src/lib/translation/detect-language.ts`, `worker/src/lib/translator.ts`, `worker/src/lib/detect-language.ts`, `worker/src/lib/page-vision.ts`.

**Synced duplicates** — several modules are maintained as independent copies in both the web app and worker and must be kept in sync manually: `output-plan.ts`, `visual-elements.ts`, `qa.ts`, `renderer.ts`/`renderer-helpers.ts`, `docx-renderer.ts`. The worker copies have a comment pointing back to the canonical `src/lib/translation-workflow/` version. `docx-visual-block.ts` is worker-only and has no web app counterpart — do not create one unless explicitly asked.

## Job status flow

`queued → ocr_in_progress → ocr_completed → translation_in_progress → pdf_rendering → completed | failed`

Each transition also updates `progress_percent` (0–100).

## Estimate API

`POST /api/documents/estimate` — OCRs the already-uploaded PDF via Mistral, counts words, and returns `{ wordCount, priceUsd }`. Pricing: `$0.01 × wordCount` USD (legacy preview only — not used for actual payment). Result is not cached — the route re-OCRs on every call.

**Real payment pricing uses the KZT quote system** — see [50_PAYMENTS_FINANCE_FISCALIZATION.md](./50_PAYMENTS_FINANCE_FISCALIZATION.md).

## Landing page system

Landing pages are config-driven. Every vertical/document page instantiates `<LandingPage config={...} />` (`src/components/landing/LandingPage.tsx`) with a typed `LandingPageConfig` object (`src/lib/landing-pages/types.ts`). Page-specific data lives in `src/lib/landing-pages/{kazakhstan,documents,shared}.ts`. Do not duplicate section components — extend the config type instead.

Currently implemented verticals: **Kazakhstan** (`src/app/[locale]/kazakhstan/`) and **documents** (`src/app/[locale]/documents/`). The Thailand vertical is planned but not yet built — no `src/app/[locale]/thailand/` directory exists.

Implemented sub-pages:
- `kazakhstan/certified-translation`, `kazakhstan/notarized-translation`, `kazakhstan/university-document-translation`
- `documents/passport-translation`, `documents/diploma-translation`, `documents/bank-statement-translation`

Both `kazakhstan/` and `documents/` also have a root `page.tsx` (the vertical landing index).

Other locale-prefixed pages: `contacts` (`src/app/[locale]/contacts/`), `auth` (login/callback), `dashboard`, `legal`, `privacy` (alias), `tos` (alias), `partners` (`src/app/[locale]/partners/`) — Partner Program landing page with application form. The /partners link appears in the Navbar (flat link, no dropdown, using `nav.partners` i18n key) and in the footer Col 1 (brand section) after the Contacts link — NOT in the legal documents section.

## Referral capture and wiring

`src/lib/referral/capture.ts` — pure client utility: `extractReferralParams(search)`, `saveReferralParams()`, `loadReferralParams()`, `clearReferralParams()`. Saves to both localStorage (30-day TTL) and sessionStorage. `loadReferralParams()` prefers localStorage (survives tab close) and discards expired entries. `src/components/referral/ReferralCapture.tsx` — client component (wrapped in Suspense in locale layout) that captures `ref` + UTM params on every page load and stores them.

`src/lib/referral/server.ts` — server-side partner referral logic (three best-effort functions):
- `attachReferralToOrder(params)` — called from upload routes after job creation; looks up active partner by `referral_code`, inserts `partner_referrals` row with `status=pending`. No-op if code absent, partner not found, or inactive.
- `confirmReferral(jobId, quoteId?)` — called from Halyk ePay callback; calculates `commission_base_kzt` (excludes `notary_official_fee` and `delivery_fee` from `price_quote_items`), applies snapshotted `commission_rate`, sets `status=confirmed` and `confirmed_at=now()`.
- `cancelReferral(jobId, reason)` — sets `status=refunded|canceled`, zeros commission. Wire to admin refund route when it moves out of 501 placeholder.

Client sends `refCode` + UTMs via FormData. Commission calculation and discount application are server-only. Dashboard wiring: the dashboard has a visible **promo code field** (`dashboard.promoCode.*` i18n keys) that is pre-filled from `loadReferralParams()` on mount. User can edit or apply the code manually; `POST /api/partners/validate-code` returns discount info for display. The field value (not storage) is used as `refCode` on submit. Server recalculates discount from DB — client values are never trusted.

**Partner client discount flow** (upload-card only):
1. Server re-validates `refCode` against `partners` table.
2. If `client_discount_enabled = true`, computes `discountKzt` (percent or fixed, capped by `client_discount_max_amount`, gated by `client_discount_min_order_amount`).
3. `finalPriceKzt = basePreDiscountKzt − discountKzt` — this is what the customer pays.
4. Referral stored with `order_amount_kzt = basePreDiscountKzt` and `client_discount_applied_kzt = discountKzt`.
5. `confirmReferral` calculates `commission_base_kzt = order_amount_kzt − client_discount_applied_kzt − pass_throughs`.

Referral statuses: `pending | confirmed | in_payout | paid | refunded | canceled | excluded`. `confirmed_at` column (migration 0039) is the authoritative payout period filter timestamp.

**Monthly payout workflow** (operator scripts — NOT automatic bank payout):
- `src/lib/partners/generate-payout.ts` — `generateMonthlyPayouts()` groups confirmed referrals by partner, creates `partner_payouts` rows (`status=pending_approval`), marks referrals `in_payout`, creates Jira Payout issues in project `WPO` / issue type `Payout` (hardcoded, not env vars).
- `src/lib/partners/mark-payout.ts` — `markPayoutPaid()` marks payout and linked referrals as paid, records `payment_reference`, optionally adds Jira comment. Idempotent.
- Scripts: `scripts/partners/generate-monthly-payout.ts` → `npm run partners:payouts`, `scripts/partners/mark-payout-paid.ts` → `npm run partners:mark-paid`.
- Jira client: `src/lib/jira/payout-client.ts` — `createPayoutIssue()`, `addPayoutPaidComment()`.
- Refunds after payout are a manual accounting task. No automatic negative adjustment system exists yet.

## Legal system

7 document types: `offer`, `privacy`, `personal-data-consent`, `refund-policy`, `disclaimer`, `terms`, `partners`. Types/slugs defined in `src/lib/legal/types.ts`. Content per locale in `src/lib/legal/content/{locale}.ts` (11 locales). Rendered at `[locale]/legal/[slug]` via `src/app/[locale]/legal/[slug]/page.tsx`. Aliases `/privacy` and `/tos` point to the appropriate slug.

## Email notifications

Sent via Resend. Web app: `src/lib/email/resend.ts` + `src/lib/email/templates.ts`. Worker: `worker/src/lib/email.ts` — calls `sendTranslationReady` after a job completes. Requires `RESEND_API_KEY` (optional; silently skips if absent) and `SITE_URL` (worker env only; defaults to `https://wpotranslations.org`).

## Rate limiting

**Middleware** (`src/middleware.ts`): in-memory per-IP limiter (per Vercel instance, not globally shared). Upload-adjacent paths: 10 req/min. Job-polling paths: 120 req/min.

**Upload route**: additional per-user limit of 10 uploads/hour enforced in the handler.

**Anonymous draft price-calculation** (`src/lib/order-drafts/rate-limit.ts`): durable DB-backed limit (`anonymous_rate_limit_events` table) at 5/hour and 20/day, keyed by session cookie OR IP — separate from the in-memory middleware limiter above, since it must survive serverless cold starts and support day-scoped windows.

## Public pre-checkout order wizard

Public route `[locale]/start` (`src/app/[locale]/start/page.tsx` → `src/components/order/OrderWizard.tsx`) lets an anonymous visitor upload a document, choose options, and see a real KZT price computed via the existing pricing engine (`computeQuoteForJob()`) — before any login is required. State lives in a new `order_drafts` table (`src/lib/order-drafts/service.ts`), keyed by an httpOnly session cookie (`src/lib/order-drafts/session.ts`) pre-login, or by `user_id` once attached.

Uploaded files land in a temporary `draft-uploads/{draftId}/` R2 prefix — never the permanent `documents/` prefix — until the draft converts. `POST /api/order-drafts/[draftId]/upload` enforces a 20 MB anonymous total-size cap (vs. 50 MB authenticated) plus a magic-byte check (`src/lib/file-validation/signature.ts`) on top of the existing MIME/extension check.

Payment requires auth: `[locale]/checkout?draftId=...` (`src/components/order/CheckoutClient.tsx`) is auth-gated in `src/middleware.ts` the same way `/dashboard` is, but additionally preserves `?draftId=` across the login detour via a `next` redirect param (`auth/login`, `auth/signup`, and `GoogleAuthButton` all now read/forward `?next=`; the `/auth/callback` route already supported it). At checkout, `convertDraftToOrder()` materializes the draft into a real `documents`/`jobs` (`status='payment_pending'`)/`price_quotes` row using the exact insert sequence `upload-card/route.ts` already uses, then renders the existing, unmodified `HalykPayButton`. Full payment-flow detail and why Halyk code stays untouched: `docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md`.

The homepage CTA (`src/app/[locale]/page.tsx`) now links to `/start` instead of `/auth/signup`. Expired, unconverted drafts are swept by the existing daily `/api/cron/cleanup` route — no new Vercel cron was added (Hobby plan allows only one).

## Supabase client split

- `src/lib/supabase/client.ts` — browser client (anon key)
- `src/lib/supabase/server.ts` — server client with service role key (for API routes and server components)

## Env validation

**Web app** (`src/lib/env.ts`): Zod, lazy-validated proxy. Validated vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_*`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`.

**Worker** (`worker/src/lib/env.ts`): validates on startup, exits if invalid. Additional worker-only vars: `RESEND_API_KEY` (optional), `SITE_URL` (default: `https://wpotranslations.org`), `POLL_INTERVAL_MS` (default: 10000), `WORKER_CONCURRENCY` (default: 1).

Worker feature flags (all optional, default to safe/live behavior):
- `APP_ENV` — `production | staging | development` (default: `production`)
- `EMAILS_ENABLED` — set to `false` to suppress all Resend calls (useful on staging)
- `EMAIL_REDIRECT_ALL_TO` — override recipient for every outgoing email (staging safety valve)
- `PAYMENTS_MODE` — `live | test` (default: `live`)
- `OFFICIAL_WORKFLOW_ENABLED` — set to `false` to disable the notarized/certified workflow path entirely

Not in Zod schemas (read via `process.env` directly): `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`.

`CRON_SECRET` must be set in the Vercel dashboard — matched against `Authorization: Bearer <secret>` sent by the Vercel cron scheduler. Do not add new env vars beyond those listed in `PROJECT_CONTEXT.md § 15`.

## shadcn/ui

Config: `components.json`. Style: `base-nova`. Uses `@base-ui/react` (not `@radix-ui/react`). Only `@radix-ui/react-slot` is retained. Add components with `npx shadcn add <component>`.

## Sentry

Three config files at root: `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`. Instrumentation entry at `src/instrumentation.ts`. Global error boundary at `src/app/global-error.tsx`.

## Code standards

- TypeScript strict mode everywhere; explicit return types on async functions
- Zod for runtime validation: env vars, LLM output, API boundaries
- All LLM calls must use retry logic with exponential backoff, max 3 retries
- Server actions for mutations; API routes only when needed (e.g. webhooks, cron)
- Never expose secrets to the client bundle
- Conventional commits
