# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read First

Always read `PROJECT_CONTEXT.md` at the start of every session. It is the authoritative source for product vision, positioning rules, business constraints, and MVP status. Do not reposition this product as a generic AI translator.

**PROJECT_CONTEXT.md caveat on payments**: Sections §6, §7, and §18 still describe TON cryptocurrency payments as "implemented" — this is outdated. TON payments have been removed from the codebase. The current payment state is described in the Payments section of this file (subscription + Halyk Bank ePay card payments; ePay code is implemented but `cardPaymentsActive` is still `false`). For everything else (vision, positioning, stack, env vars, pipeline), PROJECT_CONTEXT.md is accurate.

**Official DOCX pipeline freeze**: The DOCX / official translation pipeline is frozen for a controlled production pilot as of 2026-06-19. See `docs/OFFICIAL_DOCX_PIPELINE_FREEZE.md` for the exact list of what is and is not allowed to change. Do not modify OCR prompts, translation parameters, table-classification logic, or visual-element detection without explicit approval.

**Pipeline reference**: A detailed Russian-language step-by-step breakdown of the AI translation pipeline (OCR → protect values → translate → merge visuals → render DOCX/PDF → QA → integrations) lives in the untracked file `tech-pipline` at the repo root. Read it when debugging the DOCX output path.

---

## Branch and Environment Rules

### Branch map

| Branch | Environment | Deployed to |
|---|---|---|
| `main` | Production | Vercel Production + Railway production worker |
| `staging` | Staging | Vercel Preview + Railway staging worker |

`feature/*` and `hotfix/*` branches are **not used** unless the user explicitly requests one.

### Mandatory pre-task check

Before making any change, always run and report all three:

```bash
git branch --show-current
git status --short
git log -1 --oneline
```

### Normal workflow — commit directly to `staging`

All regular changes go directly to `staging`:

```bash
git checkout staging
git pull origin staging
# make changes
npm run typecheck && npm run lint && npm test && npm run build
git commit -m "feat: ..."
git push origin staging
```

Do **not** create `feature/*` or `hotfix/*` branches unless the user explicitly asks.

### `main` is off-limits

- Never work directly on `main`.
- Never commit to `main`.
- Never push to `main`.
- Never merge anything into `main`.
- Never deploy or promote to production unless the user explicitly says:
  > `Разрешаю продвигать staging в production`
  or gives an equally explicit production approval in any language.

### Staging rules

- Code pushed to `staging` deploys to the Vercel Preview staging site and the Railway staging worker.
- Staging must point to the **staging** Supabase project and **staging** R2 bucket. Never point staging at production resources.
- A successful staging build does not constitute approval. Wait for explicit manual acceptance.

### Production promotion (requires explicit approval)

Only after the user says `Разрешаю продвигать staging в production` (or equivalent). Before promoting, report:

1. Commits being promoted (`git log main..staging --oneline`)
2. Changed files (`git diff main..staging --name-only`)
3. Database migrations that will be applied
4. New or changed environment variable names (names only — never print values)
5. Identified risks
6. Rollback plan
7. Test results

Merge `staging` → `main` directly (fast-forward or merge commit). Do not include unrelated or untested changes.

### Hotfix workflow (only when explicitly requested)

```bash
git checkout main
git pull origin main
git checkout -b hotfix/<short-name>
# minimal fix, test
# open PR → main (with explicit approval)
# after merge to main, also cherry-pick into staging:
git checkout staging && git cherry-pick <commit>
```

### Database migrations

- Apply and test new migrations on staging Supabase first.
- Production migration is only allowed during an approved production promotion.
- Never edit an already-applied production migration — create a new forward migration instead.
- Before running any migration, identify and flag destructive operations: `DROP`, `DELETE`, column type changes, `NOT NULL` additions.

### Environment variables

- Never print or commit secret values — report variable names only.
- Label each variable by target:
  - **Vercel Preview** (staging web)
  - **Vercel Production** (production web)
  - **Railway staging** (staging worker)
  - **Railway production** (production worker)
- Fail or warn if staging config references production Supabase URLs or production R2 bucket names, and vice versa.

### Ambiguous instructions

If the user says "deploy", "release", "push it", or "make it live" without specifying staging or production, **ask before acting**.

### End-of-task report

After every task, report:

- Current branch
- Files changed
- Commands run and their results
- Test results
- Commit hash (if created)
- Where the change should be merged next
- Any required manual action in Vercel, Railway, Supabase, R2, or payment systems

See `docs/DEPLOYMENT_WORKFLOW.md` for the canonical workflow reference. Additional staging/migration references in `docs/`: `STAGING_SETUP.md`, `STAGING_ENV_VARS.md`, `STAGING_QA_CHECKLIST.md`, `MIGRATION_AUDIT.md`. Payment/fiscal setup: `docs/payments/HALYK_EPAY_INTEGRATION.md`, `docs/payments/FISCALIZATION.md`, `docs/payments/REFUNDS.md`, `docs/payments/PRODUCTION_READINESS.md`. Integration setup: `docs/TELEGRAM_NOTIFICATIONS_SETUP.md`, `docs/JIRA_AUTOMATION_SETUP.md`. Acceptance testing: `docs/OFFICIAL_TRANSLATION_ACCEPTANCE.md`. Finance: `docs/finance/FINANCIAL_ARCHITECTURE.md`, `docs/finance/PRICING_ENGINE.md`, `docs/finance/REFUND_FINANCE_RULES.md`, `docs/finance/UNIT_ECONOMICS.md`. Production operations: `docs/operations/PRODUCTION_DEPLOY_RUNBOOK.md`.

---

## Commands

### Web app (`/`)
```bash
npm run dev          # Start Next.js dev server
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit (type check without emitting)
npm run staging:check  # Validate env vars against expected list (reads .env.local)
```

### Worker (`/worker`)
```bash
cd worker
npm run dev          # tsx watch src/index.ts (hot-reload)
npm run build        # tsc → dist/
npm run start        # node dist/index.js (production)
npm run typecheck    # tsc --noEmit
npm run staging:check  # Validate worker env vars (reads worker/.env)
```

### Tests (Jest, run from repo root)
```bash
npm test                                     # Run all tests
npx jest src/lib/translation-workflow        # Run a specific directory
npx jest --testPathPattern qa                # Run matching test file(s)
```

Tests live in `src/lib/translation-workflow/__tests__/`, `src/app/api/webhooks/__tests__/`, and `worker/src/lib/__tests__/`. Config: `jest.config.ts` at repo root — covers both `src/` and `worker/src/`. Test files must match `**/__tests__/**/*.test.ts`.

### Helper scripts
```bash
bash scripts/check-i18n.sh                              # Grep locale pages/components for hardcoded strings not wrapped in t()
npx tsx scripts/telegram-list-updates.ts                # List Telegram bot updates (find chat_id for staff_profiles)
cd worker && npx tsx src/scripts/gen-acceptance.ts      # Generate acceptance-test DOCX fixtures into /tmp/wpo-acceptance/

# Finance / pricing scripts (run from repo root):
npx tsx scripts/finance/list-quotes.ts                  # List recent price quotes
npx tsx scripts/finance/inspect-job-finance.ts          # Inspect a job's full finance state
npx tsx scripts/finance/list-refundable-payments.ts     # Find payments eligible for refund
npx tsx scripts/finance/backfill-legacy-quotes.ts       # One-time backfill for pre-quote orders
```

Reference env files: `.env.example` and `.env.staging.example` (web); `worker/.env.example` and `worker/.env.staging.example` (worker). Use these as checklists when configuring new environments.

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

`POST /api/documents/upload` accepts one or more PDF, PNG, JPG, or DOCX files. Each file is capped at 25 MB; total payload at 50 MB. Multiple files are individually converted to PDF then merged via `mergePdfs()` in `src/lib/convert-to-pdf.ts` before uploading as a single R2 object. Additional optional fields: `country`, `notarized`, `bureauStamp`, `outputFormat`.

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
- **Payment eligibility gate** (`isEligible()` in `worker/src/index.ts`): subscription jobs are eligible immediately; card_payment jobs must have a `paid` or `completed` row in `payment_transactions` before the worker starts processing. Jobs that fail the gate are skipped silently until a payment arrives.
- **Graceful shutdown**: handles SIGTERM/SIGINT with up to 120 s for in-flight jobs to complete before `process.exit(0)`.
- OCR quality gate: aborts early if extracted text is below minimum word/char threshold (saves translation credits)
- Calls `computeOutputPlan(job.service_level ?? job.notarized)` to determine artifact path: `translation_only` (immediate PDF release) or `translator_review_draft` (DOCX + preview PDF, `workflow_status: awaiting_translator_review`). Pass `service_level` — the boolean `notarized` is a legacy fallback for pre-migration rows.
- Full pipeline: OCR (returns `{ markdown, pageCount, visualElements }`) → **page-vision analysis** (`analyzeDocumentVisuals` in `worker/src/lib/page-vision.ts`) → merge visual elements → **protect critical identifiers** (`extractProtectedValues` in `worker/src/lib/protected-values.ts`) → translate → restore identifiers → render HTML with visual-elements block → QA check → Puppeteer PDF or DOCX → upload to R2 → upsert `translations` (with `qa_report`) → email
- If Puppeteer fails, falls back to saving `.html`
- Supports DOCX output via `worker/src/lib/docx-renderer.ts` (also in web app at `src/lib/pdf/docx-renderer.ts`)
- Full step-by-step call graph for the official/notarized pipeline path: `docs/OFFICIAL_TRANSLATION_PIPELINE.md`
- `translateToAst()` is called non-blockingly after translation for background AST enrichment; result stored in `translations.translated_ast` but **never** used for rendering — the AST renderer (`worker/src/lib/ast/`) is wired for future opt-in only

Both processors use `claude-sonnet-4-5-20250929` via `@anthropic-ai/sdk` (constant `MODEL` in each file). There are **five** `MODEL` constants to update when changing the model: `src/lib/translation/translator.ts`, `src/lib/translation/detect-language.ts`, `worker/src/lib/translator.ts`, `worker/src/lib/detect-language.ts`, `worker/src/lib/page-vision.ts`.

**Synced duplicates** — several modules are maintained as independent copies in both the web app and worker and must be kept in sync manually: `output-plan.ts`, `visual-elements.ts`, `qa.ts`, `renderer.ts`/`renderer-helpers.ts`, `docx-renderer.ts`. The worker copies have a comment pointing back to the canonical `src/lib/translation-workflow/` version. `docx-visual-block.ts` is worker-only and has no web app counterpart — do not create one unless explicitly asked.

### Job status flow

`queued → ocr_in_progress → ocr_completed → translation_in_progress → pdf_rendering → completed | failed`

Each transition also updates `progress_percent` (0–100).

### Estimate API

`POST /api/documents/estimate` — OCRs the already-uploaded PDF via Mistral, counts words, and returns `{ wordCount, priceUsd }`. Pricing: `$0.01 × wordCount` USD (legacy preview only — not used for actual payment). Result is not cached — the route re-OCRs on every call.

**Real payment pricing uses the KZT quote system** — see Financial Architecture section below.

### Financial Architecture (quote-based pricing)

All payments use an immutable KZT quote locked before the customer pays. The flow:

```
Upload request
  → computeQuoteForJob()     — src/lib/pricing/service.ts
  → saveQuote()              — inserts price_quotes, price_quote_items, cost_reservations
  → job.price_kzt = quote.amount_kzt

Payment initiation
  → verifyQuotePayable()     — quote belongs to user/job, not expired, status=quoted
  → payment_transactions row with amount_source='quote', quote_id=...
  → markQuotePaymentPending()

Payment confirmation (Halyk callback)
  → markQuotePaid()          — commits cost_reservations, status=paid
  → ensureSaleFiscalReceiptForPaidPayment()
```

**Key rule**: `payment_transactions.amount` is always read from `price_quotes.amount_kzt`. Client-provided amounts are never used. Quotes expire in 24 h.

Pricing engine (`src/lib/pricing/calculator.ts`): language group → base minimum → extra words (beyond 250) → additional pages (beyond 1) → document type coefficient → urgency coefficient → notary components. All in KZT, rounded up to nearest 100 KZT. 17 language groups defined in `src/lib/pricing/config.ts`.

Docs: `docs/finance/FINANCIAL_ARCHITECTURE.md`, `docs/finance/PRICING_ENGINE.md`, `docs/finance/REFUND_FINANCE_RULES.md`, `docs/finance/UNIT_ECONOMICS.md`.

### translation-workflow module

`src/lib/translation-workflow/` (re-exported from its `index.ts`) drives all post-OCR logic. Its counterpart lives at `worker/src/lib/` with matching files.

- **`types.ts`** — shared types: `OutputMode`, `OutputPlan`, `VisualElement`, `VisualElementKind`, `TranslationQaReport`
- **`output-plan.ts`** — `computeOutputPlan(serviceLevelOrNotarized)`: accepts a `ServiceLevel` string (canonical) or a legacy boolean. `electronic` → `translation_only` (final PDF, released immediately). `official_with_translator_signature_and_provider_stamp` → `translator_review_draft` (DOCX + preview PDF, `workflow_status: awaiting_translator_review`, not released). `notarization_through_partners` → `notarization_package` (same artifacts, also requires notary review). `deriveBackcompatBooleans(level)` converts a `ServiceLevel` back to legacy `{notarized, bureau_stamp}` for backward-compat DB queries — use it only for old queries, not new code.
- **`visual-elements.ts`** — `extractVisualElementsFromTranslated(markdown)` and `mergeVisualElements(ocr, translated)` collect stamps, signatures, QR codes, MRZ lines, etc. **Priority order for visual element detection:** (1) `page-vision.ts` (Claude full-PDF vision — primary, returns most complete set), (2) Mistral OCR embedded images, (3) bracket markers in translated markdown (fallback only). If page-vision returns ≥1 element, OCR markers are skipped entirely.
- **`visual-elements-block.ts`** — renders the collected visual elements into an HTML block appended to the translated document (HTML renderer path only).

Worker-only modules (no `src/lib/` counterpart):
- **`page-vision.ts`** (`worker/src/lib/page-vision.ts`) — sends the full raw PDF buffer to Claude as a document block for visual-element detection. This is PRIMARY; Mistral OCR image extraction is the fallback. Non-blocking — failure returns `[]` and the pipeline continues.
- **`protected-values.ts`** (`worker/src/lib/protected-values.ts`) — extracts critical document identifiers (IBANs, BINs/IINs, passport numbers, SWIFT codes, reference codes) from the markdown before LLM translation and replaces them with opaque `{{V0001}}`-style tokens. Tokens are restored verbatim after translation, preventing any alteration of numeric/alphanumeric identifiers.
- **`docx-visual-block.ts`** (`worker/src/lib/docx-visual-block.ts`) — DOCX-native visual elements block renderer. Used by `docx-renderer.ts` instead of the HTML `visual-elements-block.ts`. Contains `VISUAL_BLOCK_I18N` with localized column headings for all supported target languages.
- **`qa.ts`** — `runQaChecks(html, mode)` returns a `TranslationQaReport`: checks for forbidden technical terms (`Claude`, `Mistral`, `JSON`, `Markdown`, `renderer`, etc.), broken glyphs, table clipping risk, orphan headings, presence of translator/verification blocks. A `qa_report` JSON is stored in the `translations` table.
- **`customer-order-state.ts`** — `getCustomerOrderState(input)` is the **canonical** function for all customer-visible order state. Returns `{ customerStatus, canDownload, isActive, isTerminal, stages, progressPercent }`. **Never duplicate this logic in components — always import from here.** `CustomerStatus` covers the full lifecycle including notarization states: `queued`, `ocr_in_progress`, `translation_in_progress`, `pdf_rendering`, `awaiting_translator_review`, `translator_approved`, `awaiting_signature_stamp`, `assigned_to_notary`, `notarization_in_progress`, `notarized`, `ready_for_delivery`, `ready_for_pickup`, `out_for_delivery`, `delivered`, `picked_up`, `translator_declined`, `notary_declined`, `completed`, `failed`, `operator_processing`. Used by `GET /api/jobs` and download gating.

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

Implemented sub-pages:
- `kazakhstan/certified-translation`, `kazakhstan/notarized-translation`, `kazakhstan/university-document-translation`
- `documents/passport-translation`, `documents/diploma-translation`, `documents/bank-statement-translation`

Both `kazakhstan/` and `documents/` also have a root `page.tsx` (the vertical landing index).

Other locale-prefixed pages: `contacts` (`src/app/[locale]/contacts/`), `auth` (login/callback), `dashboard`, `legal`, `privacy` (alias), `tos` (alias).

### Legal system

7 document types: `offer`, `privacy`, `personal-data-consent`, `refund-policy`, `disclaimer`, `terms`, `partners`. Types/slugs defined in `src/lib/legal/types.ts`. Content per locale in `src/lib/legal/content/{locale}.ts` (11 locales). Rendered at `[locale]/legal/[slug]` via `src/app/[locale]/legal/[slug]/page.tsx`. Aliases `/privacy` and `/tos` point to the appropriate slug.

### Payments

**Current state: subscription-only, no active card payment gateway.** `src/lib/stripe/` and `src/lib/polar/` are empty placeholder directories. `POST /api/subscriptions/create` returns HTTP 503 ("temporarily unavailable"). The subscription modal shows a "coming soon" message. The `jobs.payment_source` column is typed `'card_payment' | 'subscription'` — TON cryptocurrency payments are no longer present in the codebase.

**Halyk Bank ePay** (card payments in KZT). The integration is fully implemented in `src/lib/payments/halyk/` (client, config, invoice, pricing, security, status-map, locale, types). API routes: `POST /api/payments/halyk/initiate`, `POST /api/payments/halyk/callback`, `POST /api/documents/upload-card` (card-payment upload path), `GET /api/cron/reconcile-payments`. The gateway is gated by `BUSINESS_PROFILE.cardPaymentsActive` in `src/lib/business-profile.ts` (currently `false` — set to `true` only after Halyk credentials are added to env and end-to-end tested). `src/components/payment/PaymentComplianceBlock.tsx` wording switches on that flag. Do not add code to the stripe/polar directories without being asked.

Subscription plans (KZT pricing): `SUBSCRIPTION_PLANS` in `src/lib/subscriptions/config.ts` — Basic 4990 KZT/mo (10 docs), Pro 12990 KZT/mo (40 docs). Duration: 30 days. `documents_used` is incremented atomically in the upload route before creating the job.

Subscription state: `subscriptions` table. `POST /api/documents/upload` (subscription path) and `POST /api/documents/upload-card` (card payment path) are the two job-creation entry points.

**Fiscalization** (KZ tax law requires fiscal receipts for card payments). `src/lib/fiscal/` is a provider-abstracted system: `types.ts` (interface), `config.ts` (reads env), `provider.ts` (factory), `manual-provider.ts`, `webkassa-provider.ts` + `webkassa-client.ts`. Orchestration in `service.ts`: `createSaleReceiptForPayment(paymentTransactionId)` — called non-blocking after Halyk CHARGE confirms; `createRefundReceiptForRefund(...)` — called after refund is logged. Both are **idempotent** (unique constraint on `(payment_transaction_id, operation_type)` in `fiscal_receipts`) and **non-blocking** (fiscal failure never throws to the caller). Current mode: `FISCAL_PROVIDER=manual` → every receipt gets `status = pending_manual`; operator issues manually via OFD web cabinet. Webkassa provider is implemented but gated by `FISCALIZATION_ENABLED=true` + `FISCAL_PROVIDER=webkassa`. Env vars: `FISCAL_PROVIDER` (`manual`|`webkassa`), `FISCALIZATION_ENABLED` (`true`/`false`), `FISCAL_PROVIDER_ENV` (`test`/`production`). See `docs/payments/FISCALIZATION.md` for operator queries and provider onboarding steps.

**Refunds** — operator-initiated only; no customer-facing endpoint. `src/lib/refunds/service.ts`: `initiateRefund(request)` validates the refundable amount (via Supabase RPC `get_refundable_amount`), creates a `refund_transactions` row with `status = pending_manual`, then calls `createRefundReceiptForRefund`. Halyk refund API not yet integrated — operator must process manually via Halyk merchant cabinet. Admin API routes: `POST /api/admin/payments/refund` and `POST /api/admin/payments/[paymentId]/refunds`. See `docs/payments/REFUNDS.md`.

**Worker fiscal reconciliation** — `reconcileFiscalAndRefunds()` in `worker/src/lib/fiscal-reconciliation.ts` runs every 5 minutes. Finds `fiscal_receipts` with `pending`/`failed`/`retry_required` status and `refund_transactions` with `pending_manual` status, logs them for operator attention, and increments `retry_count` to throttle repeat logging. Does not auto-retry with the manual provider.

### Integration orchestrator (Jira + Google Drive + Telegram)

**Architecture principle:** WPO creates ONE Jira issue per order and then hands off — Jira Automation handles all internal transitions (assignee, security level, status, notifications). WPO never calls Jira API for transitions. After job completion a separate **Finance Report Story** is created and linked to the main issue (`relates to`); its key is stored in `jobs.finance_jira_issue_key`. Never put internal cost fields (margins, reserves) into the main order issue — finance fields go only in the Finance Report Story. Jira Automation sends callbacks to `/api/webhooks/jira` when statuses change; that route only updates Supabase and fires Telegram/email notifications.

**Web app** (`src/lib/integrations/workflow.ts`) — `initializeOrderIntegrations(job)`:
- Creates Google Drive order folder (if Drive is configured)
- Creates one Jira issue via `src/lib/jira/client.ts` — issue type is hardcoded as `Заказ`
- Sends Telegram operator notification
- All steps are optional/no-op if their env vars are absent

**Worker** (`worker/src/lib/integrations.ts`) — two phases:
- `initializeOrderIntegrations()` — runs BEFORE OCR: creates Drive folder + Jira issue
- `triggerTranslatorReview()` — runs AFTER AI draft: uploads draft PDF to Drive `02_AI_DRAFT` subfolder

**Jira credentials** (all optional — integration silently skips if absent): `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_WEBHOOK_SECRET`. Project configuration (project key, issue type name, field IDs) lives in `worker/src/lib/jira/` (not env vars).

**Jira field security** — never populate Jira fields with: document content, AI draft text, IIN/BIN or document numbers, payment credentials, file attachments. Delivery address and phone go only into `customfield_10076` / `customfield_10075` — never in the issue summary or description. See `worker/src/lib/jira/order-fields.ts` for all field IDs.

**Google Drive** (all optional): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_ROOT_FOLDER_ID`. Logic in `src/lib/google-drive/client.ts` (web) and `worker/src/lib/google-drive.ts` (worker). Drive subfolders per order: `01_ORIGINAL`, `02_AI_DRAFT`, `03_TRANSLATED`, `04_NOTARY`.

**Telegram** (all optional): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OPERATOR_CHAT_ID`, `TELEGRAM_TRANSLATOR_CHAT_ID`, `TELEGRAM_NOTARY_CHAT_ID`. Logic in `src/lib/telegram/client.ts` (web) and within `worker/src/lib/integrations.ts` (worker). Broadcast functions: `notifyOperatorNewOrder`, `notifyTranslatorNewAssignment`, `notifyNotaryNewAssignment`, `notifyOperatorTranslatorDone`, `notifyOperatorNotaryDone`, `notifyOperatorError`.

**Personal Telegram notifications** — `handleAssigneeChanged(params)` in `src/lib/notifications/assignee.ts` handles `ASSIGNEE_CHANGED` Jira webhook events. It looks up the assignee in `staff_profiles` by `jira_account_id`, builds a role-specific message (translator / notary_partner / operator), calls `sendDirectMessageWithButtons(chatId, text, buttons)`, and records every attempt in `notification_log`. Idempotent: skips if a `sent`/`pending` row already exists for the same `event_id` + `recipient_profile_id`. The `TELEGRAM_OPERATOR_CHAT_ID` / `TELEGRAM_TRANSLATOR_CHAT_ID` env vars are for broadcast fallbacks only — personal routing uses `staff_profiles.telegram_chat_id` instead.

**Notary cities** (`src/lib/notary/cities.ts`) — static registry of KZ cities where notarized-translation pickup/delivery is offered. Referenced by the notarized-translation landing page and job creation flow.

### Database tables (Supabase)

| Table | Key columns |
|---|---|
| `users` | auth users; `terms_accepted_at` — set by `POST /api/users/accept-terms` (dashboard shows acceptance gate until populated) |
| `documents` | `file_key`, `source_language`, `target_language`, `document_type`, `output_format`, `status`, `word_count`, `price_usd` |
| `jobs` | `status`, `progress_percent`, `priority`, `payment_source` (`'card_payment' \| 'subscription'`), `country`, `notarized`, `bureau_stamp`, `workflow_status`, `service_level`, `fulfillment_method` (`'pickup' \| 'delivery'`), `jira_issue_key`, `last_synced_at`, `customer_comment`, `finance_jira_issue_key`, `finance_jira_sync_status` |
| `ocr_results` | `job_id`, `markdown`, `page_count`, `provider` |
| `translations` | `job_id`, `translated_markdown`, `translated_pdf_key`, `translated_docx_key`, `translated_preview_pdf_key`, `qa_report`, `translated_ast` (background AST enrichment — non-blocking, never gates delivery) |
| `subscriptions` | `plan`, `status`, `documents_used`, `documents_limit`, `expires_at` |
| `job_audit_log` | `job_id`, `actor`, `source`, `action`, `previous_status`, `new_status`, `jira_issue_key`, `correlation_id`, `metadata` — append-only log of all status transitions and integration events |
| `staff_profiles` | `display_name`, `jira_account_id`, `telegram_chat_id`, `telegram_username`, `telegram_notifications_enabled`, `role` (`operator\|translator\|notary_partner\|admin`), `is_active` — service role only (RLS blocks browser). Unique constraint on `jira_account_id WHERE is_active=true`. |
| `notification_log` | `event_id`, `order_id`, `jira_issue_key`, `recipient_profile_id`, `channel`, `template`, `status` (`pending\|sent\|failed\|skipped`), `provider_message_id`, `error`, `sent_at` — delivery audit for every Telegram notification attempt. Unique index on `(event_id, recipient_profile_id) WHERE status IN ('sent','pending')` for idempotency. |
| `payment_transactions` | `job_id`, `document_id`, `amount`, `currency`, `status` (`pending\|paid\|failed\|expired`), `provider` (`halyk_epay`), `provider_environment` (`test\|production`), `provider_transaction_id`, `card_mask` — one row per Halyk ePay payment attempt. |
| `fiscal_receipts` | `payment_transaction_id`, `operation_type` (`sale\|refund\|correction`), `status` (`pending\|pending_manual\|issued\|failed\|retry_required`), `amount_kzt`, `provider` (`manual\|webkassa`), `fiscal_url`, `provider_receipt_id`, `receipt_payload_sanitized`, `customer_email` — migration `0017_fiscal_receipts.sql`. |
| `refund_transactions` | `payment_transaction_id`, `refund_amount_kzt`, `status` (`pending_manual\|pending\|succeeded\|failed\|requires_review`), `provider` (`halyk_epay`), `reason`, `operator_id`, `idempotency_key`, `fiscal_refund_receipt_id`, `refund_policy_case`, `approval_status` — migration `0018` + `0023`. |
| `pricing_versions` | `code`, `status` (`draft\|active\|archived`), rate columns (all numeric fractions) — one `active` row at a time. Migration `0019`. |
| `price_quotes` | `job_id`, `user_id`, `status` (`draft\|quoted\|expired\|payment_pending\|paid\|canceled\|refunded\|requires_operator_review`), `amount_kzt`, `expires_at`, `pricing_version_id` — immutable once `quoted`. Migration `0020`. |
| `price_quote_items` | `quote_id`, `item_type`, `label_key`, `amount_kzt`, `is_internal` — line-item breakdown. Migration `0021`. |
| `cost_reservations` | `quote_id`, `job_id`, `bucket` (translator/notary/ai_it/tax/etc.), `amount_kzt`, `status` (`reserved\|committed\|released`) — internal cost buckets, committed on payment. Migration `0022`. |

Generated types at `src/types/supabase.ts`, re-exported from `src/types/index.ts`. Use `Tables<'tablename'>`, `TablesInsert<'tablename'>`, `TablesUpdate<'tablename'>` for typed DB access — do not inline raw object types.

### API surface

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/documents/upload` | Upload + (for subscription html jobs) kick off web processor |
| POST | `/api/documents/estimate` | OCR + word-count pricing ($0.01/word), not cached |
| GET | `/api/documents/[documentId]/download` | Presigned R2 URL for the translated file |
| GET | `/api/jobs` | All orders for the current user — enriched with `getCustomerOrderState()` (used by dashboard list) |
| GET | `/api/jobs/[jobId]` | Single job status polling |
| POST | `/api/subscriptions/create` | 503 placeholder — payment gateway not yet active |
| GET | `/api/subscriptions/current` | Active subscription for the current user |
| POST | `/api/subscriptions/use-document` | Check quota and decrement by 1 |
| POST | `/api/documents/upload-card` | Card-payment upload path (Halyk ePay) — creates job gated by `cardPaymentsActive` |
| POST | `/api/payments/halyk/initiate` | Initiate Halyk ePay payment, returns redirect URL |
| POST | `/api/payments/halyk/callback` | Halyk ePay payment result callback — updates job payment status |
| GET | `/api/cron/cleanup` | Daily 02:00 UTC — deletes files older than 30 days (secured via `CRON_SECRET`) |
| GET | `/api/cron/reconcile-payments` | Scheduled reconciliation of Halyk ePay payment statuses |
| POST | `/api/admin/payments/refund` | Operator-initiated refund — creates `refund_transactions` row (pending_manual) |
| POST | `/api/admin/payments/[paymentId]/refunds` | Same as above, payment-scoped path |
| POST | `/api/users/accept-terms` | Records `terms_accepted_at` timestamp in users table; gate shown in dashboard before first upload |
| POST | `/api/webhooks/jira` | Inbound Jira Automation callbacks — updates Supabase job status and sends Telegram/email notifications; does NOT create Jira issues or call Jira API. `ASSIGNEE_CHANGED` events are routed to `handleAssigneeChanged()` (`src/lib/notifications/assignee.ts`) for personal Telegram delivery via `staff_profiles`. |
| POST | `/api/webhooks/stripe` | Placeholder — no route file exists; `src/lib/stripe/` is an empty directory |
| POST | `/api/webhooks/polar` | Placeholder — no route file exists; `src/lib/polar/` is an empty directory |
| GET | `/api/debug/env` | Dev-only env sanity check — not part of user-facing flows |

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

Worker feature flags (all optional, default to safe/live behavior):
- `APP_ENV` — `production | staging | development` (default: `production`)
- `EMAILS_ENABLED` — set to `false` to suppress all Resend calls (useful on staging)
- `EMAIL_REDIRECT_ALL_TO` — override recipient for every outgoing email (staging safety valve)
- `PAYMENTS_MODE` — `live | test` (default: `live`)
- `OFFICIAL_WORKFLOW_ENABLED` — set to `false` to disable the notarized/certified workflow path entirely

The following are **not** in the Zod schemas and are read via `process.env` directly in their respective handlers: `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`, `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`.

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

## Codebase Memory MCP usage

This project has codebase-memory-mcp connected in Claude Code. Use it as the first step before non-trivial analysis or code changes.

Always use codebase-memory-mcp before touching:
- pricing calculation (quote engine: `src/lib/pricing/`, `price_quotes`, `cost_reservations`)
- checkout and Halyk/ePay payment flow
- payment_transactions and order status updates
- Jira issue creation, custom fields, and workflow status mapping
- Google Drive folder/file creation
- Supabase order/payment/document logic
- PDF/DOCX generation and official translation rendering
- i18n, legal, public, footer, checkout, refund, privacy, consent, disclaimer texts
- staging/production environment separation
- worker/background processing
- file storage, Cloudflare R2, upload/download flows
- client document handling and deletion logic

Required workflow:
1. First use codebase-memory-mcp to find affected files, symbols, routes, functions, imports, and call chains.
2. Explain the blast radius and risks before editing.
3. Then read the exact affected files.
4. Then propose the patch.
5. Do not edit until the affected flow and risk points are clear.
6. After edits, use codebase-memory-mcp or git diff analysis to identify impacted flows and required QA checks.

Rules:
- Do not rely only on graph results. Always read exact files before editing.
- Do not expose or print secrets from .env files.
- Do not index or inspect real client documents.
- Do not commit .codebase-memory/.
- Do not make broad refactors unless explicitly requested.
- For payment, legal, pricing, tax, refund, notarization, and official translation logic, be conservative and explain risks first.
- For WPO, do not change the tech stack without explicit approval.
- Do not hardcode RU-only public/legal/payment texts; use i18n.
- Do not make claims like guaranteed accepted, AI certified translation, or automatic notarization.

Default prompt behavior:
When the user asks to fix, inspect, refactor, or debug WPO code, first say which codebase-memory-mcp query/tooling you will use, then inspect the graph, then continue with file reads and edits only if needed.
