# Commands and Tests

## Web app (`/`)

```bash
npm run dev          # Start Next.js dev server
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit (type check without emitting)
npm run staging:check  # Validate env vars against expected list (reads .env.local)
```

## Worker (`/worker`)

```bash
cd worker
npm run dev          # tsx watch src/index.ts (hot-reload)
npm run build        # tsc → dist/
npm run start        # node dist/index.js (production)
npm run typecheck    # tsc --noEmit
npm run staging:check  # Validate worker env vars (reads worker/.env)
```

## Tests (Jest, run from repo root)

```bash
npm test                                     # Run all tests
npx jest src/lib/translation-workflow        # Run a specific directory
npx jest --testPathPattern qa                # Run matching test file(s)
```

Tests live in:
- `src/lib/translation-workflow/__tests__/`
- `src/app/api/webhooks/__tests__/`
- `worker/src/lib/__tests__/`

Config: `jest.config.ts` at repo root — covers both `src/` and `worker/src/`. Test files must match `**/__tests__/**/*.test.ts`.

## Helper scripts

```bash
bash scripts/check-i18n.sh                              # Grep locale pages/components for hardcoded strings not wrapped in t()
npx tsx scripts/telegram-list-updates.ts                # List Telegram bot updates (find chat_id for staff_profiles)
cd worker && npx tsx src/scripts/gen-acceptance.ts      # Generate acceptance-test DOCX fixtures into /tmp/wpo-acceptance/
```

### Staging developer scripts

```bash
# Manually confirm a test payment when Halyk callback is unreachable.
# SAFETY: only works on staging. Requires ALLOW_STAGING_PAYMENT_OVERRIDE=true.
npx tsx scripts/staging/confirm-payment-paid.ts --transaction-id <uuid>
npx tsx scripts/staging/confirm-payment-paid.ts --transaction-id <uuid> --reason "Jira flow test"
```

Required env vars for staging scripts:
- `NEXT_PUBLIC_SUPABASE_URL` (staging Supabase)
- `SUPABASE_SERVICE_ROLE_KEY` (staging service role key)
- `ALLOW_STAGING_PAYMENT_OVERRIDE=true`
- `NEXT_PUBLIC_APP_ENV=staging` (must NOT be `production`)

After running, check: `payment_transactions.paid_at` set, `jobs.status = queued`, `price_quotes.status = paid`.

### Internal AI Translation Test Lab

```bash
npm run wpo:ai-test -- \
  --env-file tools/internal-ai-test-lab/.env.staging.local \
  --file ./tools/internal-ai-test-lab/input/<your-test-file> \
  --source-language ru --target-language en \
  --document-type passport --service-level official_translation
```

Runs the real OCR → translation → render → pricing pipeline against a local
file for algorithm/pricing testing, with no payment, Halyk, fiscalization,
Jira, or normal customer order created. Pricing is computed read-only via
`computeQuoteForJob()` — `saveQuote()` is never called, so no
`price_quotes`/`cost_reservations` rows are written either. Requires
`AI_TRANSLATION_TEST_LAB_ENABLED=true` in the env file; production runs
additionally require `AI_TRANSLATION_TEST_LAB_ALLOW_PRODUCTION=true` and
`--confirm-production`. See `tools/internal-ai-test-lab/README.md`.

### Finance / pricing scripts (run from repo root)

```bash
npx tsx scripts/finance/list-quotes.ts                  # List recent price quotes
npx tsx scripts/finance/inspect-job-finance.ts          # Inspect a job's full finance state
npx tsx scripts/finance/list-refundable-payments.ts     # Find payments eligible for refund
npx tsx scripts/finance/backfill-legacy-quotes.ts       # One-time backfill for pre-quote orders
```

## AI context tooling

```bash
npx tsx scripts/context/check-context.ts                                    # Validate context system (links, files, coverage, CLAUDE.md size)
npx tsx scripts/context/pre-commit-context-check.ts                         # Pre-commit guard: detect high-risk changes, run check-context if needed
npx tsx scripts/context/freshness-audit.ts                                  # Freshness audit: check if 12 context claims still match codebase
npx tsx scripts/context/add-decision.ts \
  --title "Decision title" \
  --decision "Decision text" \
  --rationale "Rationale text"                                               # Append a structured entry to DECISIONS.md
npx tsx scripts/context/suggest-context.ts "fix Halyk callback amount mismatch"  # Suggest smallest context set for a task
npx tsx scripts/context/search-context.ts "verifyQuotePayable"              # Search context docs only
npx tsx scripts/context/search-context.ts "verifyQuotePayable" --code       # Search context docs + src/ + worker/
```

## Reference env files

- `.env.example` and `.env.staging.example` — web app
- `worker/.env.example` and `worker/.env.staging.example` — worker

Use these as checklists when configuring new environments.
