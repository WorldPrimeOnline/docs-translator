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

### Finance / pricing scripts (run from repo root)

```bash
npx tsx scripts/finance/list-quotes.ts                  # List recent price quotes
npx tsx scripts/finance/inspect-job-finance.ts          # Inspect a job's full finance state
npx tsx scripts/finance/list-refundable-payments.ts     # Find payments eligible for refund
npx tsx scripts/finance/backfill-legacy-quotes.ts       # One-time backfill for pre-quote orders
```

## Reference env files

- `.env.example` and `.env.staging.example` — web app
- `worker/.env.example` and `worker/.env.staging.example` — worker

Use these as checklists when configuring new environments.
