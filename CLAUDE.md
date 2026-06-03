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

### document_type column encoding

`documents.document_type` stores a compound string `"{type}|{format}"` (e.g., `"passport_id|pdf"`, `"diploma_transcript|docx"`). Both processors call `parseDocumentType()` to split on `|` — the suffix drives output: `pdf` → Puppeteer PDF, `docx` → DOCX renderer, anything else (or no suffix) → HTML. Do not write raw document type keys without checking whether an output format suffix is expected.

Legacy key aliases (`passport` → `passport_id`, `diploma` → `diploma_transcript`, `medical` → `medical_document`, `employment` → `employment_document`) are normalised via `normalizeDocumentType()` in `src/lib/translation-prompts/index.ts`.

### Dual job processor architecture

There are **two separate processors** — do not conflate them.

**Web app processor** (`src/lib/jobs/processor.ts`):
- Called via `setTimeout(() => void processJob(...), 0)` from the upload route for **subscription jobs with `html` output only** — jobs with `pdf` or `docx` output format are left queued for the Railway worker even on the subscription path
- Runs on Vercel (no Puppeteer): OCR → translate → `renderToPdf` (which despite the name produces an HTML document, not a browser PDF) → saves `.html` to R2 → inserts into `translations`
- Uses `src/lib/ocr/mistral.ts`, `src/lib/translation/translator.ts`, `src/lib/pdf/renderer.ts`

**Railway worker** (`worker/src/processor.ts`):
- Claims jobs atomically via `UPDATE WHERE status='queued'` — prevents double-processing
- Polls Supabase every 10 s for unclaimed `status = 'queued'` jobs — handles both subscription and pay-per-doc
- OCR quality gate: aborts early if extracted text is below minimum word/char threshold (saves translation credits)
- Full pipeline: OCR → translate → render HTML → **Puppeteer PDF** → upload `.pdf` to R2 → upsert `translations` → email
- If Puppeteer fails, falls back to saving `.html`
- On completion it upserts the `translations` row (handles race with the Vercel processor)
- Supports DOCX output via `worker/src/lib/docx-renderer.ts` when the format suffix is `|docx`

Both processors use `claude-sonnet-4-5-20250929` via `@anthropic-ai/sdk` (constant `MODEL` in each `translator.ts`). `src/lib/translation/detect-language.ts` has its own identical `MODEL` constant — update all three if changing the model.

### Job status flow

`queued → ocr_in_progress → ocr_completed → translation_in_progress → pdf_rendering → completed | failed`

Each transition also updates `progress_percent` (0–100).

### Estimate API

`POST /api/documents/estimate` — OCRs the already-uploaded PDF via Mistral, counts words, and returns `{ wordCount, priceUsd }`. Pricing: `$0.01 × wordCount`. Result is not cached — the route re-OCRs on every call.

### Translation prompt system

`src/lib/translation-prompts/` assembles per-request prompts from three layers:

- **`base.ts`** — shared policies injected into every prompt: `OFFICIAL_VISUAL_ELEMENT_POLICY` (how to render stamps, signatures, QR codes, images) and `FIELD_VALUE_TRANSLATION_POLICY` (what to translate vs. protect verbatim, auto-source-language wording rules)
- **`document-prompts.ts`** — `DOCUMENT_TYPE_PROMPTS` record keyed by `DocumentType`, each with extra document-specific rules
- **`index.ts`** — `buildTranslationPrompt(params)` combines the above into `{ systemPrompt, userPrompt, expectedOutputFormat }`

`OutputMode` options: `clean_official_translation` (default), `mirror_layout_translation`, `notarization_package`, `presentation_translation` (auto-selected when `documentType === 'presentation'`).

`ServiceLevel` options: `electronic` (default), `official_with_translator_signature_and_provider_stamp`, `notarization_through_partners`.

`DocumentType` values: `passport_id`, `diploma_transcript`, `contract`, `bank_statement`, `medical_document`, `employment_document`, `police_clearance`, `visa_documents`, `driver_license`, `presentation`, `other`.

### Landing page system

Landing pages are config-driven. Every vertical/document page instantiates `<LandingPage config={...} />` (`src/components/landing/LandingPage.tsx`) with a typed `LandingPageConfig` object (`src/lib/landing-pages/types.ts`). Page-specific data lives in `src/lib/landing-pages/{kazakhstan,documents,shared}.ts`. Do not duplicate section components — extend the config type instead.

Currently implemented verticals: **Kazakhstan** (`src/app/[locale]/kazakhstan/`) and **documents** (`src/app/[locale]/documents/`). The Thailand vertical is planned but not yet built — no `src/app/[locale]/thailand/` directory exists.

Other locale-prefixed pages: `contacts` (`src/app/[locale]/contacts/`), `auth` (login/callback), `dashboard`, `legal`, `privacy` (alias), `tos` (alias).

### Legal system

7 document types: `offer`, `privacy`, `personal-data-consent`, `refund-policy`, `disclaimer`, `terms`, `partners`. Types/slugs defined in `src/lib/legal/types.ts`. Content per locale in `src/lib/legal/content/{locale}.ts` (11 locales). Rendered at `[locale]/legal/[slug]` via `src/app/[locale]/legal/[slug]/page.tsx`. Aliases `/privacy` and `/tos` point to the appropriate slug.

### Payments

**Current state: subscription-only, no active payment gateway.** `src/lib/stripe/` and `src/lib/polar/` are empty placeholder directories. `POST /api/subscriptions/create` returns HTTP 503 ("temporarily unavailable"). The subscription modal shows a "coming soon" message.

**Planned gateway: Halyk Bank ePay** (card payments in KZT). Integration is pending — controlled by `BUSINESS_PROFILE.cardPaymentsActive` in `src/lib/business-profile.ts` (currently `false`). `src/components/payment/PaymentComplianceBlock.tsx` shows Halyk ePay and Mastercard logos with wording that switches based on that flag. Do not add code to the stripe/polar directories without being asked.

Subscription plans (KZT pricing): `SUBSCRIPTION_PLANS` in `src/lib/subscriptions/config.ts` — Basic 4990 KZT/mo (10 docs), Pro 12990 KZT/mo (40 docs). Duration: 30 days. `documents_used` is incremented atomically in the upload route before creating the job.

Subscription state: `subscriptions` table. The upload route is the only path that currently creates jobs — if the user has no active subscription it returns HTTP 402.

### Database tables (Supabase)

| Table | Key columns |
|---|---|
| `users` | auth users |
| `documents` | `file_key`, `source_language`, `target_language`, `document_type`, `output_format`, `status`, `word_count`, `price_usd` |
| `jobs` | `status`, `progress_percent`, `priority`, `payment_source`, `country`, `notarized`, `bureau_stamp` |
| `ocr_results` | `job_id`, `markdown`, `page_count`, `provider` |
| `translations` | `job_id`, `translated_markdown`, `translated_pdf_key` |
| `ton_payments` | legacy pay-per-doc TON transactions (payment gateway not active) |
| `subscriptions` | `plan`, `status`, `documents_used`, `documents_limit`, `expires_at` |

Generated types at `src/types/supabase.ts`, re-exported from `src/types/index.ts`. Use `Tables<'tablename'>`, `TablesInsert<'tablename'>`, `TablesUpdate<'tablename'>` for typed DB access — do not inline raw object types.

### API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/documents/upload` | Upload + (for subscription html jobs) kick off web processor |
| POST | `/api/documents/estimate` | OCR + word-count pricing ($0.01/word), not cached |
| GET | `/api/documents/[documentId]/download` | Presigned R2 URL for the translated file |
| GET | `/api/jobs/[jobId]` | Job status polling (used by dashboard) |
| POST | `/api/subscriptions/create` | 503 placeholder — payment gateway not yet active |
| GET | `/api/subscriptions/current` | Active subscription for the current user |
| POST | `/api/subscriptions/use-document` | Check quota and decrement by 1 |
| GET | `/api/cron/cleanup` | Daily 02:00 UTC — deletes files older than 30 days (secured via `CRON_SECRET`) |

### Email notifications

Sent via Resend. Web app: `src/lib/email/resend.ts` + `src/lib/email/templates.ts`. Worker: `worker/src/lib/email.ts` — calls `sendTranslationReady` after a job completes. Requires `RESEND_API_KEY` (optional; silently skips if absent) and `SITE_URL` (worker env only; defaults to `https://wpotranslations.org`).

### Rate limiting

**Middleware** (`src/middleware.ts`): in-memory per-IP limiter (per Vercel instance, not globally shared). Upload-adjacent paths: 10 req/min. Job-polling paths: 120 req/min.

**Upload route**: additional per-user limit of 10 uploads/hour enforced in the handler.

### i18n

Translation strings: `messages/{locale}.json`. All 11 locale files must be kept in sync. Add new keys to `en.json` first, then propagate to all other locales.

### Supabase client split

- `src/lib/supabase/client.ts` — browser client (anon key)
- `src/lib/supabase/server.ts` — server client with service role key (for API routes and server components)

### env validation

Web app: `src/lib/env.ts` (Zod, lazy-validated proxy). Validated vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `R2_*`, `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`.

Worker: `worker/src/lib/env.ts` (validates on startup, exits if invalid). Additional worker-only vars: `RESEND_API_KEY` (optional), `SITE_URL` (default: `https://wpotranslations.org`), `POLL_INTERVAL_MS` (default: 10000), `WORKER_CONCURRENCY` (default: 1).

The following are **not** in the Zod schemas and are read via `process.env` directly in their respective handlers: `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `TONCONSOLE_WEBHOOK_SECRET`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`.

`CRON_SECRET` must be set in the Vercel dashboard — matched against `Authorization: Bearer <secret>` sent by the Vercel cron scheduler. Do not add new env vars beyond those listed in `PROJECT_CONTEXT.md § 15`.

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
