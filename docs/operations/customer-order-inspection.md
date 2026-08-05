# Customer order inspection (support tooling)

Read-only tools for investigating one real customer order — no UI, no admin page, no
new API route, no changes to checkout. Both tools below query the exact same tables
and, for the CLI, the exact same customer-dashboard selector the live product uses —
they never re-derive or duplicate that logic.

- `scripts/support/inspect-customer-order.sql` — run manually in the Supabase SQL Editor.
- `scripts/support/inspect-customer-order.ts` — run from your machine with real
  Supabase credentials.

Both are strictly read-only. Neither ever writes to the database, generates a signed
download URL, downloads a customer's actual document, or touches an order in any way.

## 1. Supabase SQL Editor

1. Open `scripts/support/inspect-customer-order.sql`.
2. Find-and-replace the literal string `REPLACE_JOB_ID` with the real `jobs.id` (a
   UUID) you're investigating — it appears once per section, all as the same
   placeholder, so one find-and-replace across the whole file updates every section.
3. Paste into the Supabase SQL Editor (**staging** or **production** project — pick the
   one the customer's order is actually in) and run it.
4. If your SQL Editor only shows the result of the **last** statement when you run the
   whole file at once, select and run one `-- SECTION N` block at a time instead — each
   section is a fully independent, self-contained query.

The file has 11 sections, in order: job/order, price quote + payment, source
document, pre-merge source uploads (order_drafts only — see below), document
analysis, AI drafts (translations + OCR), Official final artifacts, Notarized
artifacts/scans, customer-download artifacts, Google Drive fields, integration
errors. Read the comment block at the top of the file first — it explains the schema
assumptions baked into every section.

## 2. CLI

```bash
# Pull real credentials first if you don't already have them locally:
vercel env pull .env.production.local --environment=production
# (or .env.staging.local for a staging order)

npx tsx scripts/support/inspect-customer-order.ts --job-id <UUID>
npx tsx scripts/support/inspect-customer-order.ts --job-id <UUID> --json
npx tsx scripts/support/inspect-customer-order.ts --job-id <UUID> --markdown
```

- Default: compact human-readable report to stdout.
- `--json`: the full structured report as JSON (stdout is pure JSON — safe to pipe
  into `jq` or another tool; all progress/diagnostic messages go to stderr).
- `--markdown`: a table + findings summary + the full JSON, formatted for pasting
  directly into a support ticket or Slack thread.
- Loads `.env.production.local` then `.env.staging.local` (first value present per
  variable wins) — same convention as `scripts/prod/*.ts`. Never logs credential
  values.

The CLI additionally does two things the raw SQL can't:

1. **R2 existence checks** — `HEAD`s (never downloads) `documents.file_key` and
   `translations.translated_pdf_key`/`translated_docx_key` to confirm the objects
   genuinely exist in R2, not just that the DB column is non-null. Reports `unknown`
   if R2 credentials/connectivity aren't available rather than failing the whole run.
2. **The real customer dashboard projection** — calls
   `getCustomerOrderState()` (`src/lib/translation-workflow/customer-order-state.ts`,
   the canonical function the dashboard/`/api/jobs` route/email notifications all use)
   directly, so `customerStatus`, `stages`, and download availability in the report are
   *exactly* what the customer's dashboard shows — never a re-implementation that could
   drift from the real one.

## Interpreting Electronic / Official / Notary

All three service levels share the same tables — only `jobs.service_level` and
`jobs.workflow_status` differ in meaning:

| Service level | Digital download ever available? | Gate |
|---|---|---|
| `electronic` | Yes | `jobs.status = 'completed'` |
| `official_with_translator_signature_and_provider_stamp` | Yes, but only once approved | `workflow_status` in (`ready_for_delivery`, `delivered`) |
| `notarization_through_partners` | **Never** | Always physical delivery/pickup — `GET /api/documents/:id/download` returns 403 unconditionally |

Important: for Official, the file the customer eventually downloads is the **same**
`translations.translated_pdf_key`/`translated_docx_key` the worker rendered at
completion time — there is no separate "signed/stamped final" object stored anywhere.
The human signature-and-stamp step is tracked purely by `workflow_status` advancing;
nothing gets re-uploaded to `translations` afterward. For Notary, there is no digital
artifact at all, ever — notarization is a fully offline process. Google Drive
subfolders `04_SIGNATURE_AND_STAMP` / `05_NOTARY` / `06_FINAL` exist as manual staff
working folders (see `worker/src/lib/google-drive.ts`'s `DRIVE_SUBFOLDER_NAMES`) with
no corresponding database row — they will not show up in either tool's output beyond
the top-level `google_drive_folder_url`.

## Expected behavior for a multi-file order

A customer can select multiple files at intake (dashboard or the public `/start`
draft flow). **All of them are merged into one PDF before any processing happens**
(`mergePdfs()`, `src/lib/convert-to-pdf.ts`) — this is by design, not a bug. Concretely:

- `documents.file_key` / `jobs` / `document_analysis` / `translations` all describe
  **one** merged object. There is no per-original-file AI draft, no per-file final
  artifact, and no "download individually vs. download all" distinction — one file in,
  one file out, for the whole order.
- The only place individual pre-merge uploads are ever recorded (filename, content
  hash, per-file page count) is `order_drafts.file_keys[0]` /
  `order_drafts.analysis_snapshot`, and only for orders that went through the public
  `/start` draft flow — never for dashboard upload-card orders — and only since the
  2026-07-29 dedup fix (`sourceUploadCount`/`sourceUploadIds`/`sourceContentHashes`).
  This provenance is **not** copied forward into the real `documents`/`jobs`/
  `document_analysis` rows once the draft converts into a real order — Section 4 of
  the SQL file (and the CLI's "Source uploads" block) queries `order_drafts` directly
  for exactly this reason, and will come back empty for any dashboard-flow order.
- If you're investigating "customer says only 1 of their 2 uploaded pages appears
  translated," the multi-file merge is a real, common cause worth ruling in/out first
  — check Section 4 / the CLI's `sourceUploadCount` for the linked draft, and compare
  it against `document_analysis.physical_page_count`.

## Typical malfunctions to check for

- **`documents.file_key` set but R2 HEAD returns not-found** (CLI: `r2Existence.sourceExists = false`) — the source object was deleted or never actually uploaded; the order can't be reprocessed without the customer re-uploading.
- **`translations` row missing on a `completed` job** — worker crashed after marking the job complete but before the DB write, or a partial retry; flagged automatically under "Missing expected artifacts."
- **Official `workflow_status` at `ready_for_delivery`/`delivered` but no `translated_docx_key`** — the DOCX render step didn't run or failed silently; customer-facing download will 404. Flagged automatically.
- **`order_drafts.file_keys[0].sourceUploadCount > 1`** — confirms a genuine multi-file order; check `document_analysis.physical_page_count` matches the combined page count you'd expect, not just one source file's.
- **`last_integration_error` / `*_jira_last_error` non-null** — Jira/Drive sync failed; the order itself may be fine, but the operator-facing tracking (main issue, price breakdown, finance report) may be missing or stale. Cross-check `job_audit_log` (Section 8/11) for the actual failure.
- **`quote.status = 'requires_operator_review'` with no corresponding job progress** — pricing never completed automatically; see this repo's pricing incident history (`docs/ai-context/DECISIONS.md`) for why WPO has no manual-operator-pricing fallback — this should be rare/transient, not a steady state.
