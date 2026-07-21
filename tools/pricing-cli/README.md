# WPO Pricing CLI

A local, offline-by-default CLI that batch-calculates pricing for real documents using the
**real** production `calculatePrice()` (`src/lib/pricing/calculator.ts`) — no web UI, no server,
no side effects. Replaces the deleted internal Pricing Lab web tool (removed 2026-07-20; see
`docs/ai-context/DECISIONS.md`).

## Quick start

```bash
mkdir -p test-documents
# drop passport.pdf, diploma.docx, statement.pdf, certificate.jpg into test-documents/

npm run pricing:calculate -- --input ./test-documents
```

Reports land in `pricing-results/<timestamp>/`.

For plain DOCX / born-digital PDF documents, **no environment variables and no credentials are
needed at all** — this only changes if a scanned PDF or image actually needs real OCR (see
"OCR and environment variables" below).

## What this is NOT

- **Not a payment/order bypass.** Never creates `orders`, `documents`, `jobs`, `price_quotes`,
  or `cost_reservations` rows. Never calls Halyk, never creates a fiscal receipt.
- **Not an integration tool.** Never calls Jira, Google Drive, Telegram, or email.
- **Not a config activator.** Never writes to `pricing_versions` and never activates a new
  pricing version — economics overrides (§ Temporary economics overrides) are in-memory only
  for the duration of this process.
- **Not the real UI.** There is no web page for this — this is a terminal tool only.

## Supported files

`.docx`, `.pdf` (born-digital or scanned), `.jpg`, `.jpeg`, `.png`. Anything else in the input
folder (including `manifest.json`/`manifest.example.json`, other JSON, dotfiles like
`.gitkeep`, stray notes) is silently skipped during discovery — it never becomes a file result.
`manifest.json` is read separately as configuration (see below), never as a document.

| Type | How it's analyzed |
|---|---|
| DOCX | `mammoth.extractRawText()`, then `normalizeSourceTextForPricing()` |
| PDF (text layer) | Embedded text layer extracted directly (`pdf-parse`) |
| PDF (scanned) | Falls back to real Mistral OCR when the text layer is empty/too sparse |
| JPG/JPEG/PNG | Converted to a one-page PDF, then OCR'd the same way a scanned PDF would be |

All of this reuses `src/lib/document-analysis/*` (`analyze.ts`, `docx.ts`, `pdf-text-layer.ts`,
`physical-pages.ts`, `normalize.ts`) verbatim — the same functions the real pre-payment
`document_analysis` pipeline will use. This CLI never re-implements extraction.

## Configuration — the 5-layer priority chain

For every file, parameters are resolved in this order (highest wins):

```
CLI flags  >  manifest per-file entry  >  manifest defaults  >  pricing-test-config.json  >  safe defaults
```

### 1. `pricing-test-config.json` (optional)

Copy `pricing-test-config.example.json` to `./pricing-test-config.json` (repo root, or anywhere
via `--config`):

```json
{
  "pricingVersionCode": "2026-Q3-KZ-NEWMODEL",
  "sourceLanguage": "ru",
  "targetLanguage": "en",
  "serviceLevel": "official_with_translator_signature_and_provider_stamp",
  "applicantType": "individual",
  "deliveryRequired": false,
  "notaryUrgency": "standard",
  "channel": "direct",
  "partnerCommissionRate": 0,
  "manualAdjustmentKzt": 0
}
```

If `--config` is omitted, `./pricing-test-config.json` is used automatically if it exists;
otherwise the built-in safe defaults apply (same values as the example above).

### 2. `manifest.json` (optional, per-file overrides)

Copy `test-documents/manifest.example.json` to `<input-dir>/manifest.json` (or point `--manifest`
anywhere):

```json
{
  "defaults": { "sourceLanguage": "ru", "targetLanguage": "en", "serviceLevel": "official" },
  "files": {
    "passport.pdf": { "serviceLevel": "notary", "applicantType": "individual", "deliveryRequired": true, "notaryUrgency": "after_noon" },
    "diploma.docx": { "targetLanguage": "de" }
  }
}
```

### 3. CLI flags

```bash
npm run pricing:calculate -- \
  --input ./test-documents \
  --source ru --target en --service notary \
  --applicant individual --delivery --urgency after_noon \
  --channel referral --partner-rate 0.10
```

The **applied parameters are always shown in each file's report** — you can see exactly which
layer decided each value.

### Field reference

| Field | CLI flag | Values |
|---|---|---|
| Pricing version | `--pricing-version` | e.g. `2026-Q3-KZ-NEWMODEL` (local mode only knows this one — see § Pricing version source) |
| Source/target language | `--source` / `--target` | ISO-639-1-ish codes (`ru`, `en`, `kk`, ...) |
| Service level | `--service` | `electronic`, `official`, `notary` (aliases for the canonical enum — the full enum string also works) |
| Applicant type | `--applicant` | `individual`, `legal_entity` |
| Delivery | `--delivery` | boolean flag |
| Notary urgency | `--urgency` | `standard`, `same_day`, `before_noon`, `after_noon`, `after_18` |
| Sales channel | `--channel` | `direct`, `referral` |
| Partner commission override | `--partner-rate` | `0..1` |
| Manual adjustment | `--manual-adjustment` / `--manual-adjustment-reason` | KZT / text |
| Language rate override | `--language-rate` | KZT per translation page |
| Manual physical page count | `--manual-physical-pages` | integer ≥ 1 — overrides analysis; use when a reliable count needs rendering (DOCX) and analysis returned none |

## Pricing version source

**Local (default, offline):** a literal copy of the WPO-approved `2026-Q3-KZ-NEWMODEL` draft seed
(`supabase/migrations/0051`, `0056`, `0057`) plus its 14 RU→X language rates — see
`lib/default-pricing-version.ts`. No credentials needed. Any other `pricingVersionCode` in local
mode is a config error (there is only one built-in version) — use `--from-staging` instead.

**Staging (`--from-staging`, read-only):** fetches the real `pricing_versions` /
`pricing_language_rates` row by code from the actual staging database via
`src/lib/pricing/service.ts`'s `getPricingVersionByCode()` / `getLanguageRate()` — pure reads,
never `saveQuote()`/`markQuotePaid()`. Requires `NEXT_PUBLIC_SUPABASE_URL` +
`SUPABASE_SERVICE_ROLE_KEY` — the same two vars `src/lib/supabase/server.ts` always uses. This
**is** the service-role key, not the anon key — `pricing_versions` and `pricing_language_rates`
both have RLS enabled with **zero** policies (`supabase/migrations/0019`, `0050`: "no user can
read pricing internals; service_role bypasses"), so there is no narrower/anon-readable path;
this matches the production pricing service's own access pattern exactly.

**Fail-fast:** with `--from-staging`, both vars are checked immediately after env loading —
before any file is discovered or analyzed. Missing either exits **3** once, printing only the
missing variable *names* (never values), and creates zero per-file reports:

```
Configuration error:
Missing environment variables required for --from-staging:
- NEXT_PUBLIC_SUPABASE_URL
- SUPABASE_SERVICE_ROLE_KEY
```

## Temporary economics overrides

All in-memory only — never written to `pricing_versions`, never activates anything. Every report
that used one says so explicitly ("Использована временная настройка").

```
--override-tax-rate --override-acquiring-rate --override-risk-reserve-rate
--override-owner-reserve-rate --override-marketing-rate --override-ai-it-rate
--override-channel-reserve-rate --override-discount-rate --override-wpo-coordination-rate
--override-translator-payout-rate --override-partner-commission-rate --override-ocr-rate
--override-courier-fee --override-printing-fee --override-extra-copy-fee
--override-rounding-step-official --override-rounding-step-notary --override-mrp
```

**Not overridable:** the notary applicant-type MRP coefficient
(`NOTARY_APPLICANT_MRP_COEFFICIENT` in `src/lib/pricing/config.ts`) — it's a module-level
constant, not a `PricingVersion` field, and `calculatePrice()` takes no config-override
parameter. Overriding it would mean monkey-patching a frozen/shared pipeline module, which this
tool deliberately never does.

## Environment variable loading

This CLI runs locally via `tsx`, so Vercel's env is never available — env loading is explicit
and happens once, at startup, before any Supabase client could be constructed. Four sources are
merged in this **priority order** (highest wins; a source only fills in what's still unset):

1. Already-exported `process.env` (e.g. from your shell)
2. `--env-file <path>` (any dotenv file)
3. `./.env.local` (repo root — the same file `npm run dev` already reads, if you have one)
4. `tools/pricing-cli/.env.staging.local` — only loaded when `--from-staging` or real OCR
   (no `--no-ocr`) is used

```bash
npm run pricing:calculate -- \
  --input ./test-documents --from-staging --env-file ./.env.local \
  --source ru --target en --service official --no-ocr
```

The startup banner prints exactly which file(s) were actually loaded (paths only, never values).

**DOCX / a PDF with a usable text layer needs zero environment variables.** Real OCR (a scanned
PDF or image, without `--no-ocr`) needs exactly **one** — `MISTRAL_API_KEY` — checked up front,
read directly from `process.env`, and passed straight into `extractTextFromPdf()`'s dependency-
injection option (`@/lib/ocr/mistral.ts`). This CLI **never** imports `@/lib/env` (the web app's
full env schema — `NODE_ENV`, `R2_*`, `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, ...)
for OCR, so none of those are ever required here, and `NODE_ENV` is never touched — it isn't the
same thing as `NEXT_PUBLIC_APP_ENV`, which this CLI also never needs.

```bash
cp tools/pricing-cli/.env.example tools/pricing-cli/.env.staging.local
# fill in MISTRAL_API_KEY (and Supabase creds if also using --from-staging)
npm run pricing:calculate -- --input ./test-documents --from-staging
```

### `--no-ocr`

DOCX and text-layer PDFs are still priced normally. Scanned PDFs and images become
`status: operator_review` instead of calling paid OCR.

### `--dry-run`

For each discovered file, prints the 8 resolved parameters (`sourceLanguage`, `targetLanguage`,
`serviceLevel`, `applicantType`, `deliveryRequired`, `notaryUrgency`, `channel`,
`partnerCommissionRate`) and which layer of the priority chain actually supplied each one
(`CLI` / `file manifest` / `manifest defaults` / `config` / `default`). This is a completely
separate code path from a real run — it never calls document analysis, OCR, or
`calculatePrice()`, never builds a report, never assigns a `success`/`operator_review`/`failed`
status, and never creates the output directory at all. Always exits `0`.

## Local cache

Extraction/OCR results are cached locally by `sha256(file bytes + mime type)` under
`.pricing-cache/` — re-running the same file never re-invokes OCR. Never synced anywhere, never
stores secrets (only extracted text + page counts). `--no-cache` ignores it for one run;
`--clear-cache` deletes it first.

## Error handling & exit codes

One bad file never stops the batch. Each file resolves to exactly one status:

| Status | Meaning |
|---|---|
| `success` | Priced normally, reconciliation OK |
| `operator_review` | Needs a human look (no text, possibly illegible, no language rate, `--no-ocr` skip) — not a crash |
| `failed` | Technical/tooling failure (encrypted/corrupted PDF, OCR API error, invalid config, reconciliation mismatch) |

| Exit code | Meaning |
|---|---|
| `0` | Every file succeeded |
| `1` | At least one file `failed` |
| `2` | Only `operator_review` results, no `failed` |
| `3` | Globally invalid config (bad `--input`, bad JSON, missing required field) — no files were processed |

## Output

```text
pricing-results/<timestamp>/
  summary.csv
  summary.json
  summary.md
  passport.report.json
  passport.report.md
  diploma.report.json
  diploma.report.md
```

`summary.csv` columns: filename, status, analysis_method, physical_pages,
characters_with_spaces, character_pages, billable_translation_pages, translation_page_basis,
source_language, target_language, language_rate, service_level, translation_amount, ocr, notary,
courier, wpo_coordination, component_subtotal, gross_up, standard_retail, urgency_multiplier,
urgency_surcharge, retail, discount, actual_payment, translator_payout, notary_payout,
courier_payout, partner_commission, internal_reserves, marginal_profit, margin, reconciliation,
reason.

`physical_pages` / `character_pages` / `billable_translation_pages` / `translation_page_basis` are
reported separately and always come from the real calculator breakdown (never conflated into one
ambiguous "translation_pages" column) — e.g. a 2-physical-page, 671-character document reports
`physical_pages=2`, `character_pages=0.372778`, `billable_translation_pages=2`,
`translation_page_basis=physical_pages`.

`*.report.md` is a Russian-language financial report (no English enum values, UUIDs, or debug
JSON) — see `lib/russian-report.ts`, ported from the deleted Pricing Lab's `PricingLabResult.tsx`.

## Fixtures

```bash
npm run pricing:fixtures
```

Runs the 6 WPO-approved worked-example scenarios (7 400 / 13 000 / 28 000 / Referral 6 660 /
3 366 chars → 5 610 / stress RU→TH) directly against `calculatePrice()` — console output only,
pass/fail per scenario, exit 1 if any fail.

## Full example

```bash
npm run pricing:calculate -- \
  --input ./test-documents \
  --config ./pricing-test-config.json \
  --output ./pricing-results \
  --source ru --target en --service notary \
  --applicant individual --delivery --urgency after_noon \
  --channel referral --partner-rate 0.10
```

## What NOT to do

- Do not add a second pricing calculator here — always call `calculatePrice()` from
  `src/lib/pricing/calculator.ts` directly.
- Do not modify `src/lib/pricing/calculator.ts`, `src/lib/pricing/config.ts`, or
  `src/lib/document-analysis/*` to "make this tool work" — those are shared/frozen modules; if
  this tool needs different behavior, extend `tools/pricing-cli/lib/`, not the shared pipeline.
- Do not commit `.env*.local`, anything under `test-documents/` (except the example files) or
  `pricing-results/`, or `.pricing-cache/` — all gitignored by design.
- Do not point `--from-staging` at production, and do not add a production mode to this tool —
  it is staging/local only.

## Developing / verifying this tool

```bash
npm run typecheck              # root app — must stay clean, untouched by this tool
npm run pricing:typecheck      # tsc --noEmit -p tools/pricing-cli/tsconfig.json
npm test                       # jest — tools/pricing-cli is in jest.config.ts roots
npm run lint                   # eslint
```
