# WPO Internal AI Translation Test Lab

A CLI-only tool for running the **real** OCR → translation → render → pricing
pipeline against local document(s), for internal algorithm and pricing
testing — without payment, without Halyk, without fiscalization, without
Jira, and without creating a normal customer order. Supports both a single
document (**single-file mode**) and a whole folder of documents in one
command (**batch mode**, for launch QA across many language pairs/document
types) — see "Batch mode" below.

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

## Batch mode

Runs every document listed in a `batch-manifest.json` sequentially (or with
`--concurrency 2`), one right after another, so you can cover many language
pairs/document types in a single command for launch QA. Batch execution
**relies only on the manifest** — it never guesses source/target
language or document type from a filename.

### 1. Create the input folder

```bash
mkdir -p tools/internal-ai-test-lab/input/batch
# copy your real QA-pack documents in — gitignored by design, never committed
```

### 2. Generate a draft manifest (optional helper)

```bash
npm run wpo:ai-test -- \
  --input-dir ./tools/internal-ai-test-lab/input/batch \
  --generate-manifest-template \
  --output-manifest ./tools/internal-ai-test-lab/input/batch-manifest.template.json
```

This parses filenames like `01_ru_kk_identity_card_complex.pdf` (leading
index, source language, target language, remaining tokens as a document-type
guess) into a draft manifest. It is deliberately conservative — an
unrecognized document type becomes `"documentType": "other"` with a "please
review" note, and a filename with no language token leaves
`sourceLanguage`/`targetLanguage` blank with a note to fill it in. **This is
only a starting point** — batch execution itself never reads filenames, only
the manifest you review and save as `batch-manifest.json`.

### 3. Review/edit the manifest

Required fields per entry: `file`, `sourceLanguage`, `targetLanguage`,
`documentType`, `serviceLevel`. Optional: `urgency`, `fulfillmentMethod`,
`notaryCity`, `deliveryCity`, `notes`, `expectedWarnings`, `tags`.

```json
[
  {
    "file": "01_ru_kk_identity_card_complex.pdf",
    "sourceLanguage": "ru",
    "targetLanguage": "kk",
    "documentType": "identity_card",
    "serviceLevel": "electronic_translation",
    "notes": "Complex ID card layout"
  }
]
```

A committed draft covering the 2026-07-03 launch QA pack (28 documents,
many language pairs/document types) already lives at
`tools/internal-ai-test-lab/input/batch-manifest.json` — the real document
files are not included (gitignored); add them to `input/batch/` before
running it, and re-review the two entries flagged in `notes` (`08`, `25` use
document types with no dedicated canonical enum member, and `27` had no
language token in its filename so source/target were assumed).

Before running, the CLI always prints a validation summary — fails on a
missing manifest/input-dir, a manifest entry referencing a missing file,
duplicate file entries, missing required fields, or an unknown
document type/service level/urgency/fulfillment method (reusing the same
`lib/alias-map.ts` used by single-file mode); warns (but does not block) on
a document type that falls back to `"other"` or a language code outside
`src/i18n/locales.ts`.

### 4. Run — staging

```bash
npm run wpo:ai-test -- \
  --env-file tools/internal-ai-test-lab/.env.staging.local \
  --input-dir ./tools/internal-ai-test-lab/input/batch \
  --manifest ./tools/internal-ai-test-lab/input/batch-manifest.json \
  --output-dir tools/internal-ai-test-lab/runs \
  --continue-on-error
```

### 5. Run — production (extra confirmation required)

```bash
npm run wpo:ai-test -- \
  --env-file tools/internal-ai-test-lab/.env.production.local \
  --input-dir ./tools/internal-ai-test-lab/input/batch \
  --manifest ./tools/internal-ai-test-lab/input/batch-manifest.json \
  --output-dir tools/internal-ai-test-lab/runs \
  --confirm-production \
  --continue-on-error
```

**Cost warning: batch mode spends real OCR/LLM API credits for every
document in the manifest** — this is printed in the startup banner every run.
A 28-document manifest means 28 real OCR + 28 real translation calls.

### Batch-only options

| Flag | Meaning |
|---|---|
| `--input-dir <folder>` | Folder the manifest's `file` entries are resolved against |
| `--manifest <path>` | Path to `batch-manifest.json` |
| `--continue-on-error` | Explicit form of the default — keep going after a failed item (default for batch QA) |
| `--stop-on-error` | Stop the batch the moment an item fails |
| `--limit <n>` | Only run the first `n` selected entries |
| `--only <a.pdf,3,...>` | Comma-separated file names and/or 1-based manifest positions — run just those |
| `--skip-existing` | Skip an item whose output folder already has a completed report; marks it `skipped` in the summary |
| `--concurrency <n>` | `1` (default, sequential) or `2` — see "Concurrency" below |

### Concurrency

**Defaults to 1 (sequential)** — documents run one at a time. Pass
`--concurrency 2` to run two documents at once; **the CLI hard-rejects
anything above 2**. Running documents in parallel multiplies real-time
OCR/LLM API cost and materially raises the risk of hitting Mistral/Anthropic
rate limits mid-batch — keep this at 1 unless you specifically need the
throughput and have verified your API tier can take it. With
`--concurrency 2` and `--stop-on-error`, an in-flight pair both still
complete even if one fails; the batch stops before starting the *next* pair.

### Batch output structure

```text
tools/internal-ai-test-lab/runs/batch_<timestamp>_<shortId>/
  batch-summary.json
  batch-summary.csv
  batch-summary.html
  batch.log
  items/
    01_ru_kk_identity_card_01_ru_kk_identity_card_complex/
      source/
      ocr/
      translation/
      rendered/
      pricing/
      report/
      run.log
    02_en_th_passport_02_en_th_passport_biodata_visa/
      ...
```

Each item folder reuses the exact same single-run layout as single-file mode
(see "Output files" below) — nested under `items/<safe-folder-name>/` instead
of its own top-level `runs/<run-id>/`. Folder names are always
`<index>_<source>_<target>_<documentType>_<slug-of-filename>` — lowercase,
`_`-separated, no spaces or other unsafe characters.

### Reading batch-summary.html

Open it directly in a browser — a self-contained page (dark theme, no
external assets) with one row per manifest entry: language pair, document
type, service level, status, final price, reconciliation status, links to
the generated DOCX/HTML/diagnostic-PDF/report files, OCR page/word counts,
warnings (expandable), and error code/message for any failed item. Failed
rows are visually highlighted (red) and labelled `FAILED`; skipped rows are
labelled `SKIPPED`. `batch-summary.json` and `.csv` carry the same data for
scripted review.

### Error handling

A failed item does not stop the batch by default (`--continue-on-error` is
the implicit default for batch QA) — it's recorded with `status: "failed"`,
an `errorCode`/`errorMessage`, and still gets its own item folder (with
`run.log`) so you can see exactly where it broke. Pass `--stop-on-error` to
halt immediately on the first failure instead.

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
- **The PDF this tool generates is not an electronic-delivery preview.**
  Electronic (`--service-level electronic`) client delivery is DOCX + HTML
  only in production — this CLI still renders a PDF for every run as an
  internal diagnostic artifact regardless of service level. See "Output
  files" below.

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

Mode is auto-detected from which flags are present — `--input-dir`/
`--manifest` → batch mode, `--generate-manifest-template` → template mode,
otherwise single-file mode (unchanged from the original tool).

**Single-file mode required:** `--env-file`, `--file`, `--source-language`,
`--target-language`, `--document-type`, `--service-level`.

**Batch mode required:** `--env-file`, `--input-dir`, `--manifest`.

**Template mode required:** `--input-dir`, `--output-manifest`.

Shared optional flags: `--output-dir` (default
`tools/internal-ai-test-lab/runs`), `--save-to-r2`, `--dry-run-pricing-only`,
`--skip-render`, `--keep-intermediate`, `--debug`, `--debug-full-text`,
`--confirm-production`.

Single-file-only optional: `--urgency`, `--fulfillment-method`,
`--notary-city`, `--delivery-city`.

Batch-only optional: `--continue-on-error`, `--stop-on-error`, `--limit`,
`--only`, `--skip-existing`, `--concurrency` — see "Batch mode" above.

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
    translated-document.INTERNAL_TEST.docx
    translated-document.INTERNAL_TEST.html
    translated-document.INTERNAL_DIAGNOSTIC_ONLY.pdf
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

**`translated-document.INTERNAL_DIAGNOSTIC_ONLY.pdf` is an internal
diagnostic artifact only — never a client-facing format.** As of the
2026-07-02 electronic output policy (see
`docs/ai-context/40_TRANSLATION_PIPELINE.md`), the production pipeline
generates DOCX + HTML for electronic-service-level client delivery and never
PDF. This CLI mirrors that: `translated-document.INTERNAL_TEST.docx` and
`translated-document.INTERNAL_TEST.html` are the real client-facing formats
(generated for every service level, so official/notarized drafts can be
reviewed too), and it *additionally* renders a PDF purely so operators can
visually inspect Puppeteer/renderer output — its filename says
`INTERNAL_DIAGNOSTIC_ONLY` for exactly this reason. For
`official_with_translator_signature_and_provider_stamp` /
`notarization_through_partners` service levels, none of these three files are
a final deliverable either way — the real pipeline's human
translator/notary review step, and the resulting signed/stamped/notarized
PDF or notary package, happen entirely outside this tool.

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
  under `runs/` / `input/` (except the checked-in `batch-manifest.json`
  templates, which contain no document content) — gitignored by design.
- Do not run a full production batch without first validating the manifest
  and running a small staging batch (`--limit 2`) — batch mode multiplies API
  spend by the number of manifest entries, and a bad manifest entry affects
  every item that references it.
- Do not raise `--concurrency` above 2 — the CLI rejects it, but don't try to
  work around that; see "Concurrency" above.
