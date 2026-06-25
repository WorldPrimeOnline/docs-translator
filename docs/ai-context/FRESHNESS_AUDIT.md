---
name: freshness-audit
description: When to run the context freshness audit and how to interpret results
type: context-tooling
---

# Context Freshness Audit

## Purpose

`scripts/context/freshness-audit.ts` checks whether high-risk context claims in `CLAUDE.md` and `docs/ai-context/` still match the current codebase. Context docs can become stale after product, payment, or workflow changes — this script provides deterministic, repo-local verification with no external API calls.

## What it checks

| # | Check | Files inspected |
|---|---|---|
| 1 | CLAUDE.md size | `CLAUDE.md` |
| 2 | Halyk card payment activation state | `src/lib/business-profile.ts` + context docs |
| 3 | Halyk API route existence | `src/app/api/payments/halyk/initiate`, `callback`, `upload-card`, `reconcile-payments` |
| 4 | Quote-based pricing integrity | `src/lib/pricing/service.ts` — checks `verifyQuotePayable`, `markQuotePaid`, `price_quotes` |
| 5 | Payment transaction table references | `src/types/supabase.ts` — checks `payment_transactions`, `provider_transaction_id`, `provider_environment` |
| 6 | Subscription create placeholder state | `src/app/api/subscriptions/create/route.ts` — detects 503/placeholder vs. active |
| 7 | Stripe/Polar placeholder state | `src/lib/stripe/`, `src/lib/polar/` — warns if non-empty |
| 8 | Fiscalization provider files | `src/lib/fiscal/` — checks expected files and env-var references |
| 9 | Refunds state | `src/lib/refunds/service.ts` — checks `initiateRefund`, `refund_transactions`, `pending_manual` |
| 10 | DOCX pipeline freeze | `docs/OFFICIAL_DOCX_PIPELINE_FREEZE.md` — checks freeze doc exists and CLAUDE.md mentions it |
| 11 | Worker payment eligibility gate | `worker/src/index.ts` — checks `isEligible`, `payment_transactions`, `card_payment`, `subscription` |
| 12 | Jira/Telegram integration files | `src/app/api/webhooks/jira/route.ts`, `src/lib/notifications/assignee.ts`, `worker/src/lib/integrations.ts` |

## What it does NOT check

- Application logic correctness — only that key identifiers/files still exist
- Whether context prose descriptions are semantically accurate beyond the known claim patterns
- Env variable values (never reads `.env*` files — secrets are never printed)
- Test coverage or runtime behaviour
- Non-committed changes (operates on files as they exist on disk)

## When to run

Run after any change to:

- Payments, fiscalization, or refunds (`src/lib/payments/`, `src/lib/fiscal/`, `src/lib/refunds/`)
- Quote/pricing system (`src/lib/pricing/`)
- Official translation pipeline (`worker/src/processor.ts`, `worker/src/lib/`, `src/lib/translation-workflow/`)
- Jira / Google Drive / Telegram integrations (`src/lib/jira/`, `worker/src/lib/integrations.ts`, `src/lib/notifications/`)
- Production/staging deployment rules or env validation (`vercel.json`, `src/lib/env.ts`, `worker/src/lib/env.ts`)
- Legal or i18n public content (`messages/`, `src/lib/legal/`)

Also run as part of any production promotion checklist.

The pre-commit guard (`scripts/context/pre-commit-context-check.ts`) detects when high-risk areas changed and reminds you to run this audit. Run them together:

```bash
npx tsx scripts/context/pre-commit-context-check.ts
npx tsx scripts/context/freshness-audit.ts
```

## Command

```bash
npx tsx scripts/context/freshness-audit.ts
```

## How to interpret results

### PASS

All 12 checks passed — no contradictions, no missing files, no detected staleness. Context docs appear to match the codebase.

### WARN

One or more checks found a potential mismatch. WARN is not a hard failure:

- **Review each warning in context.** Many WARNs describe current known state (e.g. `cardPaymentsActive: false` is correct and expected — context should document this).
- **Update the relevant context doc** if a WARN reveals that a context doc is wrong or outdated.
- Exit code is `0` for WARN — does not block commits.

### FAIL

A hard failure occurred:

- `CLAUDE.md` exceeds the 15,000-char hard ceiling, **or**
- A required file checked internally by the script is missing.

Exit code is `1` — treat this as blocking.

## Technical notes

- Node.js built-ins only (`fs`, `path`, `process`) — no npm packages.
- Searches context docs via regex line-by-line scan; not semantically aware.
- ANSI colour output: green = ok, yellow = warn, red = fail.
- High-risk domains in the routing table (`docs/ai-context/CONTEXT_ROUTER.md`) correspond directly to the checks above.
