# WPO Internal AI Translation Test Lab

A CLI-only tool for running the **real** OCR → translation → render → pricing
pipeline against a local document, for internal algorithm and pricing
testing — without payment, without Halyk, without fiscalization, without
Jira, and without creating a normal customer order.

**Every file this tool produces is an internal test artifact.** It is never
an official, notarized, or client-deliverable document — see "What this is
NOT" below.

## Quick start

```bash
# 0. One-time: worker's puppeteer/chromium deps are needed for PDF rendering
cd worker && npm install && cd ..

# 1. Configure
cp tools/internal-ai-test-lab/.env.example tools/internal-ai-test-lab/.env.staging.local
# edit .env.staging.local with real staging credentials

# 2. First run — staging (<your-test-file> is anything you place under input/ —
#    see "Supported input formats" below; it does not need to be named passport.pdf)
npm run wpo:ai-test -- \
  --env-file tools/internal-ai-test-lab/.env.staging.local \
  --file ./tools/internal-ai-test-lab/input/<your-test-file> \
  --source-language ru --target-language en \
  --document-type passport --service-level official_translation

# 3. First run — production (extra confirmation required, see "Production
#    safety rules" below; consumes real Mistral/Anthropic API spend)
npm run wpo:ai-test -- \
  --env-file tools/internal-ai-test-lab/.env.production.local \
  --file ./tools/internal-ai-test-lab/input/<your-test-file> \
  --source-language ru --target-language en \
  --document-type passport --service-level official_translation \
  --confirm-production
```

Output lands in `tools/internal-ai-test-lab/runs/<timestamp>_<run-id>/`.

## Supported input formats

`--file` accepts **any file path** with a supported extension — there is no
required filename. File **format** (technical: how the bytes are encoded)
and business **document type** (`--document-type`: passport, bank_statement,
diploma, ...) are completely independent concepts; the document type is
*only* ever taken from `--document-type`, never guessed from the filename.

| Extension | MIME type | How OCR gets it |
|---|---|---|
| `.pdf` | `application/pdf` | passed straight to `extractTextFromPdf()` |
| `.jpg` / `.jpeg` | `image/jpeg` | converted to a real single-page PDF first |
| `.png` | `image/png` | converted to a real single-page PDF first |
| `.docx` | `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | text-extracted (via `mammoth`) and reflowed into a plain PDF first |

Non-PDF conversion reuses `src/lib/convert-to-pdf.ts` — the **same** module
the production upload routes (`/api/documents/upload`,
`/api/documents/upload-card`) already use for JPG/PNG/DOCX uploads. This tool
never relabels a JPG as a PDF and sends it to Mistral/Claude — both
`extractTextFromPdf()` and page-vision hardcode `application/pdf`, so a real
conversion happens first (see `lib/input-document.ts`).

Examples:

```bash
# JPG bank statement
npm run wpo:ai-test -- \
  --env-file tools/internal-ai-test-lab/.env.staging.local \
  --file ./tools/internal-ai-test-lab/input/stress_01_phone_photo_shadow_bank_statement.jpg \
  --source-language ru --target-language en \
  --document-type bank_statement --service-level official_translation

# PNG passport
npm run wpo:ai-test -- \
  --env-file tools/internal-ai-test-lab/.env.staging.local \
  --file ./tools/internal-ai-test-lab/input/passport_scan.png \
  --source-language ru --target-language en \
  --document-type passport --service-level official_translation

# DOCX contract
npm run wpo:ai-test -- \
  --env-file tools/internal-ai-test-lab/.env.staging.local \
  --file ./tools/internal-ai-test-lab/input/contract.docx \
  --source-language ru --target-language en \
  --document-type contract --service-level electronic
```

DOCX layout preservation in this tool is **partial** — `mammoth` extracts
plain text only (no tables/headings/formatting), reflowed into a simple PDF.
The report's OCR/translation warnings will say so explicitly whenever the
input is a `.docx` file. An unsupported extension (e.g. `.txt`) fails
immediately with a clear error, before any env loading or API calls.

## What this is NOT

- **This is not a payment bypass.** It never creates `payment_transactions`,
  never calls Halyk ePay, and never marks anything "paid."
- **It must not be used to deliver client orders.** Output files are watermarked
  `INTERNAL TEST — NOT CLIENT ORDER — NOT PAID — NOT FOR DELIVERY` and must
  never be sent to a real customer.
- **It does not prove third-party acceptance of translations.** A clean run
  proves the algorithm executed, not that a consulate/university/bank will
  accept the output.
- **It does not create official/notarized legal output by itself.** For
  `official_translation` / `notarized` service levels, the real pipeline
  produces a translator **draft** — the human translator/notary review step is
  still required in production and is intentionally not part of this tool.

## Why this is separate from the payment/Jira/order workflow

Testing the real algorithm previously meant creating a real job — which
triggers Jira issue creation, Google Drive folders, Telegram notifications,
and (once Halyk is live) a real payment. This tool imports the *same*
pipeline modules the Railway worker uses (OCR, translator, renderer,
docx-renderer, pricing calculator) directly, but:

- Never writes to `jobs`, `documents`, or `translations` — no row for this
  run exists in the normal customer tables.
- Never calls `saveQuote()` — pricing is computed via `computeQuoteForJob()`,
  which only **reads** `pricing_versions` and runs the pure calculator. No
  `price_quotes` / `price_quote_items` / `cost_reservations` rows are created.
- Never imports Halyk, Webkassa/OFD, Jira, Google Drive, Telegram, or Resend
  modules.
- Writes all output to a local `runs/` folder (gitignored), optionally
  mirrored to a clearly separated R2 prefix (`internal-tests/ai-translation-lab/`)
  — never the normal `documents/<user_id>/<document_id>/...` path.

## Env setup

```bash
cp tools/internal-ai-test-lab/.env.example tools/internal-ai-test-lab/.env.staging.local
# edit .env.staging.local with real staging credentials — never commit it
```

See `.env.example` for the full variable list and comments. Variable names
match exactly what the real pipeline already reads (`worker/src/lib/env.ts`,
`src/lib/supabase/server.ts`) — this tool does not invent new env vars.

Note: because importing *any* `worker/src/lib/*` module pulls in
`worker/src/lib/env.ts`, Supabase and R2 credentials are required even if you
never pass `--save-to-r2` — the worker's env schema validates them
unconditionally at import time.

## Production safety rules

If `APP_ENV=production` or `NEXT_PUBLIC_APP_ENV=production` in the loaded env
file, the CLI refuses to run unless **all** of the following hold:

1. `AI_TRANSLATION_TEST_LAB_ENABLED=true`
2. `AI_TRANSLATION_TEST_LAB_ALLOW_PRODUCTION=true`
3. `--confirm-production` is passed on the command line
4. `ALLOW_STAGING_PAYMENT_OVERRIDE` is **not** `true` — this variable must
   never be enabled in production; the CLI fails hard if it sees it, no
   matter what else is set.

`AI_TRANSLATION_TEST_LAB_ENABLED=true` is required in every environment
(local/staging/production), not just production.

On every run the CLI prints a safety summary before doing anything else:

```
WPO AI Translation Test Lab
Environment: staging
Payment bypass: disabled
Halyk: disabled
Jira: disabled
Fiscalization: disabled
Normal order creation: disabled
Output dir: tools/internal-ai-test-lab/runs/<run_id>
R2 save: false
```

## Command examples

Staging, full pipeline:

```bash
npm run wpo:ai-test -- \
  --env-file tools/internal-ai-test-lab/.env.staging.local \
  --file ./tools/internal-ai-test-lab/input/<your-test-file> \
  --source-language ru \
  --target-language en \
  --document-type passport \
  --service-level official_translation \
  --urgency standard
```

Production (requires explicit confirmation):

```bash
npm run wpo:ai-test -- \
  --env-file tools/internal-ai-test-lab/.env.production.local \
  --file ./tools/internal-ai-test-lab/input/<your-test-file> \
  --source-language ru \
  --target-language en \
  --document-type passport \
  --service-level official_translation \
  --confirm-production
```

Pricing only, no translation/render spend (still runs real OCR to get real
word/page counts):

```bash
npm run wpo:ai-test -- \
  --env-file tools/internal-ai-test-lab/.env.staging.local \
  --file ./tools/internal-ai-test-lab/input/<your-test-file> \
  --source-language ru --target-language en \
  --document-type passport --service-level electronic \
  --dry-run-pricing-only
```

Direct `tsx` invocation (equivalent):

```bash
npx tsx tools/internal-ai-test-lab/run-ai-translation-test.ts \
  --env-file tools/internal-ai-test-lab/.env.staging.local \
  --file ./tools/internal-ai-test-lab/input/<your-test-file> \
  --source-language ru --target-language en \
  --document-type passport --service-level official_translation
```

### CLI options

Required: `--env-file`, `--file`, `--source-language`, `--target-language`,
`--document-type`, `--service-level`.

Optional: `--urgency`, `--fulfillment-method`, `--notary-city`,
`--delivery-city`, `--output-dir` (default `tools/internal-ai-test-lab/runs`),
`--save-to-r2`, `--dry-run-pricing-only`, `--skip-render`,
`--keep-intermediate`, `--debug`, `--debug-full-text`, `--confirm-production`.

### Alias mapping (CLI value → canonical enum)

This tool reuses the project's existing enums verbatim — it never invents new
ones. See `lib/alias-map.ts` for the authoritative table.

`--service-level`:
| CLI alias | Canonical `ServiceLevel` |
|---|---|
| `electronic` | `electronic` |
| `official_translation`, `official` | `official_with_translator_signature_and_provider_stamp` |
| `notarized`, `notarization` | `notarization_through_partners` |

`--document-type` (examples — see `lib/alias-map.ts` for the full list):
| CLI alias | Canonical `DocumentType` |
|---|---|
| `passport` | `passport_id` |
| `diploma`, `transcript` | `diploma_transcript` |
| `bank`, `bank_statement` | `bank_statement` |
| `birth_certificate`, `marriage_certificate` | `other` (no dedicated enum member exists yet) |

`--urgency`: `standard`, `within_24h`/`24h`, `express`→`six_to_twelve_hours`,
`rush`→`two_to_four_hours`, `night_or_weekend`/`overnight`.

`--notary-city` / `--delivery-city` are recorded in the report for human
review and `--delivery-city` is mapped through a coarse heuristic onto the
pricing engine's `deliveryZone` enum (`almaty` → `almaty_standard`, anything
else → `other_city`). This is **not** authoritative geocoding.

## Output files

```text
tools/internal-ai-test-lab/runs/<timestamp>_<short-run-id>/
  source/
    original-file.<ext>
    source-metadata.json
  ocr/
    ocr-result.json
    extracted-text.txt
    ocr-raw-pages.json        (only with --keep-intermediate)
  translation/
    translation-result.json
    translated-text.md
    qa-report.json
  rendered/
    translated-document.INTERNAL_TEST.pdf
    translated-document.INTERNAL_TEST.docx
  pricing/
    pricing-context.json
    price-items.json
    internal-costs.json
    margin.json
    reconciliation.json
  report/
    report.INTERNAL_TEST.json
    report.INTERNAL_TEST.md
    report.INTERNAL_TEST.html
  run.log
```

The `.INTERNAL_TEST.` filename marker exists because the underlying renderer
(frozen — see `docs/OFFICIAL_DOCX_PIPELINE_FREEZE.md`) is not modified to
inject a custom watermark string into the PDF/DOCX body; the filename and the
report banner carry the warning instead.

If DOCX or PDF rendering fails (e.g. no headless Chromium binary available in
your environment), the run does not abort — a warning is logged and recorded
in the report's "Rendered Output" section, matching the same non-fatal
fallback behavior as the production worker.

The pricing tables in the report **intentionally include zero-amount rows**
(e.g. `included_words = 0 KZT`, `notary_official_fee = 0 KZT` on an
electronic order) — they prove the component was checked and either folded
into the minimum package or correctly not applicable, with a `metadata`
column explaining why.

## Troubleshooting

- **"AI_TRANSLATION_TEST_LAB_ENABLED must be set to true"** — add it to your
  `--env-file`.
- **"Missing required environment variables" crash from a worker module** —
  every `worker/src/lib/*` import validates the full worker env schema
  (Supabase + R2 + Anthropic + Mistral) at import time, even for pieces you
  don't think you need. Fill in all vars from `.env.example`.
- **PDF rendering fails locally** — `@sparticuz/chromium` needs its bundled
  binary; this normally works out of the box if `worker/node_modules` is
  installed (`cd worker && npm install`). If it still fails, use
  `--skip-render` to still get OCR/translation/pricing output.
- **Pricing shows `PRICING_NOT_CONFIGURED`** — no active row in
  `pricing_versions` for the environment you're pointed at.
- **`--service-level` / `--document-type` rejected** — check the alias table
  above; the tool refuses unknown values rather than silently guessing.
- **"Unsupported input file extension"** — only `.pdf`, `.jpg`, `.jpeg`,
  `.png`, `.docx` are supported (see "Supported input formats" above); this
  fails immediately, before any env loading or API calls.
- **"File extension implies X, but the file's magic bytes look like Y"
  warning in the report** — the file's real content doesn't match its
  extension (e.g. a `.pdf` that's actually a renamed JPEG). The tool proceeds
  using the extension-declared type and surfaces this as a warning rather
  than failing, since a mislabeled-but-still-decodable file is common with
  manually renamed test fixtures.

## Developing / verifying this tool

`tools/` is excluded from the root `tsconfig.json` (same precedent as
`scripts/`) because this tool cross-imports `worker/src/lib/*`, which is
type-checked under looser settings than the root Next.js app. It has its own
tsconfig and typecheck script instead:

```bash
npm run typecheck              # root app + web — must stay clean, untouched by this tool
npm run wpo:ai-test:typecheck  # tsc --noEmit -p tools/internal-ai-test-lab/tsconfig.json
npm test                       # jest — tools/internal-ai-test-lab is in jest.config.ts roots
npm run lint                   # eslint — tools/ is not in the eslint ignore list
```

`__tests__/no-forbidden-integrations.test.ts` statically scans every `.ts`
file in this tool (excluding `__tests__` itself) for Halyk/Webkassa/Jira/
Resend/Drive/Telegram import specifiers, payment/fiscal/order writer function
call-sites, and direct writes to `jobs`/`price_quotes`/`payment_transactions`/
etc. — run it after any change to `run-ai-translation-test.ts` or `lib/`.

## Comparing multiple runs

Each run gets its own timestamped folder under `runs/`. To compare two runs:

```bash
diff tools/internal-ai-test-lab/runs/<run-A>/pricing/pricing-context.json \
     tools/internal-ai-test-lab/runs/<run-B>/pricing/pricing-context.json

diff tools/internal-ai-test-lab/runs/<run-A>/translation/translated-text.md \
     tools/internal-ai-test-lab/runs/<run-B>/translation/translated-text.md
```

`report.INTERNAL_TEST.json` is the most useful single file for scripted
comparison (`price_breakdown_json`, `margin_json`, `warnings_json` are all
in there).

## What NOT to do

- Do not send any output file from this tool to a real customer.
- Do not point `--env-file` at production without
  `AI_TRANSLATION_TEST_LAB_ALLOW_PRODUCTION=true` **and** understanding that
  a production run consumes real Mistral/Anthropic API spend.
- Do not set `ALLOW_STAGING_PAYMENT_OVERRIDE=true` anywhere near a production
  env file.
- Do not modify `worker/src/lib/{ocr,translator,renderer,docx-renderer,qa,
  visual-elements,output-plan}.ts` or `src/lib/pricing/calculator.ts` to "make
  this tool work" — those are the frozen/shared production modules; if the
  tool needs different behavior, extend this tool's own `lib/`, not the
  shared pipeline.
- Do not add a second pricing calculator here — always call
  `computeQuoteForJob()` from `src/lib/pricing/service.ts`.
- Do not commit `.env.production.local`, `.env.staging.local`, or anything
  under `runs/` / `input/` — all gitignored by design.
