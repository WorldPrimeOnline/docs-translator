# Official Translation Acceptance Checklist

Manual acceptance checklist for the WPO official translation pipeline.  Applies to `official_with_translator_signature_and_provider_stamp` and `notarization_through_partners` jobs.

---

## Pre-acceptance: system checks

Before opening the DOCX, verify in Supabase + R2:

- [ ] `jobs.status` = `completed`
- [ ] `jobs.workflow_status` = `awaiting_translator_review`
- [ ] `translations.translated_docx_key` ends in `.docx`
- [ ] `translations.translated_preview_pdf_key` ends in `.pdf` (may be null if Puppeteer failed)
- [ ] `translations.qa_report` is present (JSON, not null)
- [ ] `documents.status` = `in_review` (not `completed`)
- [ ] R2 file exists at `translated_docx_key`
- [ ] Google Drive `02_AI_DRAFT` folder contains `ai_draft.docx` (if Drive is configured)

---

## QA report review

Read `translations.qa_report`. Check:

- **`ok: false`** — QA identified issues. Inspect the `errors` array.  QA is advisory: the DOCX may still be usable.
- **`hasForbiddenTechnicalTerms: true`** — LLM artefacts present (e.g. "Claude", "JSON"). Reject and re-queue.
- **`hasBrokenGlyphs: true`** — Encoding issue. Reject and check source document encoding.
- **`hasTranslatorBlock: false`** — Translator certification block missing from HTML. Check DOCX for the section.
- **`sourceWarnings`** — Advisory notes about the source document. Review with translator before contacting customer.

---

## DOCX acceptance checks

Open `ai_draft.docx` in LibreOffice or Word.

### Protected values (§1 — must pass)

| Check | Acceptable | Reject if |
|---|---|---|
| Identity numbers (IIN, BIN, passport) | Exact match to source | Changed, translated, or missing |
| Bank account numbers (IBAN/IIK) | Exact match | Any digit or letter changed |
| BIC / SWIFT codes | Exact match | Any change |
| Contract / certificate numbers | Exact match | Any change |
| Dates in numeric format (dd.mm.yyyy) | Exact match | Reformatted or translated |
| Reference / verification codes | Exact match | Any change |

### Table structure (§2 — must pass)

| Check | Acceptable | Reject if |
|---|---|---|
| Column count | Same as source | Any table gained or lost columns |
| Data row count | Same as source | Rows added, merged, or dropped |
| Key–value alignment | Each label opposite its value | Pairs mixed up |

### Headings (§3 — must pass)

- All major section headings present and translated into target language.
- No heading left in source language (except proper nouns).

### Visual elements block (§4 — must pass)

Located at the end of the document.  Check:

- [ ] Table present with columns: Element, Page, Position, Description
- [ ] Correct element count matches source document
- [ ] Watermark text is translated (if visibleText was detected by OCR/vision)
- [ ] Stamp text is localised appropriately
- [ ] No `__WPO_VIS_` tokens visible

### Language and script (§5 — must pass)

- [ ] Body text is in target language
- [ ] No source-language words in headings or field labels
- [ ] No mixed-script blends (e.g. "SAMPLE ҮЛГІЛІК ОБРАЗЕЦ")
- [ ] RTL documents: text direction is correct in DOCX

### Translator draft block (§6 — should pass for `official_with_translator_signature_and_provider_stamp`)

- [ ] `## Translator` section present at document end
- [ ] Translator name field (to be completed by translator)
- [ ] Translator certification statement
- [ ] Date field

---

## Translator work assessment categories

After review, classify each DOCX into one of:

| Category | Meaning | Examples |
|---|---|---|
| **terminology / language review only** | Structure correct, values correct, minor phrasing to polish | Standard employment certificate, bank statement |
| **minor formatting** | Structure correct, but some table alignment or heading issues | Diploma with unusual layout, contract with nested sections |
| **major reconstruction required** | Significant sections missing, table structure broken, values incorrect | Handwritten document, poor scan, unusual format |

**Acceptance criteria:** `terminology / language review only` or `minor formatting` are acceptable for handoff to translator.  `major reconstruction required` means the pipeline produced a draft that needs rework — log and investigate.

---

## Known causes of "major reconstruction required"

1. Source document is a poor scan (< 150 DPI, skewed pages, handwriting).
2. Source has complex nested tables that Mistral OCR flattened incorrectly.
3. Source has non-standard encodings (some Arabic / Thai scans).
4. Very short documents (< 100 words) where the minimum-length guard may have allowed a near-empty translation through.

---

## Performance benchmarks (approximate, Railway worker)

| Stage | Typical duration |
|---|---|
| OCR (Mistral, 1–2 pages) | 5–15 s |
| Visual analysis (Claude Vision, 1–2 pages) | 10–30 s |
| Translation (Claude Sonnet) | 15–45 s |
| Table retry (if needed) | + 15–45 s |
| Coverage retry (if needed) | + 15–45 s |
| DOCX render | < 1 s |
| HTML render + Puppeteer PDF | 5–15 s |
| R2 upload | < 2 s |
| **Total (typical)** | **40–120 s** |
| **Total (worst case with 2 retries)** | **120–250 s** |

---

## Failure matrix

| Failure | Retry | Fallback | Job status | Artifact saved | Operator notified |
|---|---|---|---|---|---|
| OCR fail | No | No | `failed` | No | Via job status |
| Low-quality OCR | No | No | `failed` | No | Via job status |
| Translation timeout | No | No | `failed` | No | Via job status |
| Table shape mismatch | 1× retranslate | Keep original | `completed` | DOCX (original) | Via QA report |
| Missing protected token | No | Forced restore | `completed` | DOCX with forced restore | Via QA log |
| Vision fail | No | OCR elements | `completed` | DOCX (OCR fallback) | Via log |
| DOCX render fail | No | No (fatal) | `failed` | No | Via job status |
| Preview PDF fail | No | DOCX only | `completed` | DOCX only | Via log |
| R2 upload fail | No | No (fatal) | `failed` | No | Via job status |
| DB update fail | No | No (fatal) | `failed` | May be in R2 | Via job status |
| Google Drive fail | No | Skip Drive | `completed` | DOCX in R2 | Via log |
| Telegram fail | No | Skip notify | `completed` | DOCX in R2 | No (check Supabase) |

---

## Staging smoke test (manual)

1. Upload a sanitized official document (see `tmp/final-quality-patch/` for examples).
2. Confirm job appears in Supabase `jobs` with `service_level = 'official_with_translator_signature_and_provider_stamp'`.
3. Wait for worker to process (check Railway logs for job tag).
4. Verify Supabase: `jobs.status = 'completed'`, `workflow_status = 'awaiting_translator_review'`.
5. Verify R2: `translator_draft.docx` exists at `translations.translated_docx_key`.
6. Verify R2: `preview.pdf` exists at `translations.translated_preview_pdf_key` (if Puppeteer available).
7. Verify Google Drive `02_AI_DRAFT` contains `ai_draft.docx` and `ai_draft_preview.pdf` (if Drive configured).
8. Download DOCX from R2.
9. Open in LibreOffice Writer.
10. Apply §1–§6 checks above.
11. Classify translator work category.

**DO NOT use real customer documents for staging smoke tests.**

---

## Disclaimer

The AI-generated draft produced by this pipeline is a working document for a professional translator.  It has not been reviewed by a human translator and **must not be delivered to any third party or accepted as a certified translation without human review and signature.**  WPO does not guarantee that any translated document will be accepted by government bodies, courts, or other institutions.
