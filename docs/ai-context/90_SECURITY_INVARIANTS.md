# Security Invariants

These rules are always active, regardless of task. Violating any of them is never acceptable without explicit written approval.

## Secrets

- Never print or commit secret values — report variable names only.
- Never expose secrets to the client bundle.
- Do not expose or print secrets from `.env` files.
- `CRON_SECRET` must be set in the Vercel dashboard and matched server-side — never hardcode it.

## Payment integrity

- `payment_transactions.amount` is **always** read from `price_quotes.amount_kzt`. Client-provided amounts are never used.
- Never bypass `verifyQuotePayable()` before initiating a payment transaction.
- Never set `cardPaymentsActive = true` without Halyk credentials in env and successful end-to-end test.
- Fiscal receipts are non-blocking but idempotent — never remove the idempotency constraint on `fiscal_receipts`.

## Data isolation — staging vs. production

- Staging must point to the **staging** Supabase project and **staging** R2 bucket.
- Never point staging at production resources; never point production at staging resources.
- Fail or warn if staging config references production Supabase URLs or R2 bucket names, and vice versa.

## Jira / third-party field security

**Never populate Jira fields with:**
- Document content
- AI draft text
- IIN/BIN or document numbers
- Payment credentials
- File attachments

Delivery address and phone go only into `customfield_10076` / `customfield_10075` — never in the issue summary or description.

## Client document handling

- Do not index or inspect real client documents.
- Do not store document content in logs, Jira, or any system not explicitly designed for it.
- Protected values (`{{V0001}}`-style tokens) must always be restored verbatim after translation — never let them leak into final output.

## Codebase integrity

- Do not commit `.codebase-memory/`.
- Do not make broad refactors unless explicitly requested.
- Do not change the tech stack without explicit approval.
- Do not add new env vars beyond those listed in `PROJECT_CONTEXT.md § 15`.
- DOCX/official pipeline is frozen — do not modify OCR prompts, translation parameters, table-classification logic, or visual-element detection without explicit approval.

## Claims and marketing

- Never claim "guaranteed accepted" for any translation.
- Never claim "AI certified translation".
- Never claim "automatic notarization".
- Do not reposition WPO as a generic AI translator.

## LLM calls

- All LLM calls must use retry logic with exponential backoff, max 3 retries.
- Validate all LLM output with Zod before using it downstream.
- `qa.ts` checks for leaked technical terms in output — never remove these checks.
