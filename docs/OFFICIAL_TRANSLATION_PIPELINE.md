# Official Translation Pipeline

Documents the Railway worker pipeline for `official_with_translator_signature_and_provider_stamp` and `notarization_through_partners` service levels.

---

## Architecture: why not AST

The AST renderer (`worker/src/lib/ast/`) was built as a future upgrade path but is not wired into the official output path.  Reasons:

1. **Stability first.** The legacy markdown pipeline already handles protected values, table shape preservation, visual element inventory, and DOCX/PDF rendering at a quality sufficient for translator handoff.
2. **Zero disruption.** Switching renderers mid-pipeline risks introducing regressions in certified document output.  The AST path remains available in the codebase for future opt-in.
3. **Single-path invariants.** The official path asserts `renderDocxFromAst` and `renderHtmlFromAst` are never called (`pipeline-architecture.test.ts`).

`translateToAst` is called non-blockingly after translation for background enrichment (stored in `translations.translated_ast`).  It never gates delivery.

---

## Call graph

```
[Railway worker poll]
  ↓ claim job atomically (UPDATE WHERE status='queued')
  ↓ load document + job metadata
  ↓ initializeOrderIntegrations() [non-electronic jobs]
      → create Google Drive folder (01_ORIGINAL, 02_AI_DRAFT, 03_TRANSLATED, 04_NOTARY)
      → create Jira issue
      → send Telegram operator notification
  ↓ OCR  (Mistral)
  ↓ assessOcrQuality()  — script-aware quality gate
  ↓ [fail fast if OCR too low]
  ↓ checkSourceCompleteness()  — advisory warnings stored in QA report
  ↓ detectSourceLanguage()  [if source_language=auto]
  ↓ extractAndProtectValues()  — replace identifiers with __WPO_PV_NNNN__ tokens
  ↓ analyzeDocumentVisuals()  [vision + OCR element merge → DetectedVisualElement[]]
  ↓ serializeVisualInventory()  — prepend __WPO_VISUAL_BLOCK_START__ block to markdown
  ↓ translateDocument()  [Claude Sonnet]
  ↓ parseAndRemoveInventoryBlock()  — extract translated inventory, remove block
  ↓ compareMarkdownTableShapes()  — detect column/row count changes
      → if mismatch: retranslateWithCorrection()  [one retry]
  ↓ restoreProtectedValues()  — replace tokens with original values
  ↓ buildFinalVisualBlock()  — append visual elements table
  ↓ checkContentCoverage()  — pre-render integrity checks
      → if retryNeeded && !usedTableRetry: retranslateWithCorrection()  [one retry]
  ↓ validateTranslationScript()  — detect wrong-script fragments
      → if issues: retranslateWithCorrection()  [one retry]
  ↓ translateToAst()  [background, non-blocking, result stored only]
  ↓ runStructuralReview()  — detect untranslated/transliterated headings
  ↓ applyStructuralCorrections()
  ↓ renderToDocx()  — produce ai_draft.docx
  ↓ upload docx to R2
  ↓ renderToHtml()  — for preview PDF
  ↓ runQaChecks()  — advisory only, stored in qa_report
  ↓ generatePdfFromHtml()  — Puppeteer → preview PDF
  ↓ upload preview PDF to R2
  ↓ upsert translations row (translated_markdown, translated_docx_key, translated_preview_pdf_key, qa_report)
  ↓ update job status → completed, workflow_status → awaiting_translator_review
  ↓ triggerTranslatorReview()
      → upload ai_draft.docx to Drive 02_AI_DRAFT
      → upload ai_draft_preview.pdf to Drive 02_AI_DRAFT
      → update Supabase jira_sync_status
      → send Telegram translator notification
  ↓ sendDocumentReceivedForReview()  — email to customer
```

**NOT called on the official path:**
- `translateToAst` as a rendering step (background enrichment only)
- `renderDocxFromAst`
- `renderHtmlFromAst`

---

## Supported document profiles

| Type | Notes |
|---|---|
| `employment_document` | Employment certificate, leave documentation |
| `passport_id` | Passports, national IDs |
| `diploma_transcript` | University diplomas, academic transcripts |
| `contract` | Service agreements, employment contracts |
| `bank_statement` | Account statements, transaction histories |
| `medical_document` | Medical certificates, health records |
| `police_clearance` | Criminal record certificates |
| `visa_documents` | Visa applications, invitation letters |
| `driver_license` | Driving licences |
| `other` | General documents, RTL (Arabic), CJK (Chinese/Korean/Japanese), Thai |

---

## Protected values

`extractAndProtectValues()` (`worker/src/lib/protected-values.ts`) replaces the following before translation:

- IIN / BIN (Kazakhstan national numbers)
- IBAN / IIK (bank account numbers)
- BIC / SWIFT codes
- Passport / document numbers
- Contract / certificate / reference numbers
- Dates in numeric formats
- Phone numbers
- Emails / URLs
- Cyrillic-script organisation names (to prevent transliteration)

Replaced with `__WPO_PV_0001__` ... `__WPO_PV_NNNN__`.  Restored exactly after translation.

---

## Visual analysis

`analyzeDocumentVisuals()` (`worker/src/lib/page-vision.ts`) calls Claude Vision per page to detect:

- Logos
- Watermarks (with `visibleText` field for OCR-confirmed text)
- Stamps (round / rectangular)
- Signatures
- QR codes / barcodes
- Electronic approval marks
- Photos

Results are merged with Mistral OCR visual element hints.  The serialized inventory block is prepended to the translation input so Claude can localise visual text (e.g., watermark text).  A `hasMixedLatinCyrillic()` guard rejects hallucinated multi-language blends.

**Failure behaviour:** if vision fails, OCR-derived elements are used as fallback.  Workflow never fails due to vision error.

---

## Fallback behaviour

| Failure | Behaviour |
|---|---|
| OCR too low quality | Job fails immediately with user-readable message |
| Vision analysis fails | Fallback to OCR elements; non-fatal |
| Translation API timeout | Job fails (outer catch); no partial artifact |
| Table shape mismatch | One retry via `retranslateWithCorrection`; if retry fails, continue with original |
| Content coverage check fails | One retry if `!usedTableRetry`; if retry fails, continue with warning |
| Script validator finds issues | One retry; if no improvement, keep original |
| Structural review fails | Advisory only; continue with original |
| Preview PDF generation fails | Warning logged; DOCX still delivered |
| R2 upload fails | Job fails (fatal) |
| DB update fails | Job fails (fatal) |
| Google Drive upload fails | Warning logged; non-fatal; workflow continues |
| Translator notification fails | Warning logged; non-fatal; workflow continues |
| Email send fails | Warning logged; non-fatal |

---

## Warnings

Warnings are stored in `translations.qa_report` as JSON.  Codes:

### QA report warnings (translation quality)
| Code | Meaning |
|---|---|
| `Translator certification block not found` | HTML missing `## Translator` section |
| `Visual elements section not found` | HTML missing visual elements block |
| `Forbidden technical terms present` | Claude/Mistral/JSON etc. appear in output |
| `Broken glyphs detected` | Replacement character (□) in output |
| `Table clipping risk` | Table may exceed page width |

### Source completeness warnings (source document checks)
| Code | Meaning |
|---|---|
| `PAGE_COUNT_MISMATCH` | `Page X of Y` states Y but OCR extracted fewer pages |
| `STATED_PAGE_COUNT_MISMATCH` | `Number of pages: N` doesn't match OCR page count |
| `CALENDAR_DAYS_MISMATCH` | Stated calendar-day count differs from inclusive date range |
| `WORKING_DAYS_DISCREPANCY` | Stated working days differ significantly from Mon–Fri count |
| `VALIDITY_BEFORE_DEPARTURE` | Document validity ends before declared departure date |

All source completeness warnings explicitly note that the discrepancy may reflect holidays, non-standard schedules, or different counting conventions.  **Never stated as legal errors.**

### Content coverage errors (pre-render integrity)
| Code | Meaning |
|---|---|
| `EMPTY_TRANSLATION` | Translation body is empty |
| `TRANSLATION_TOO_SHORT` | < 80 chars after stripping visual/translator blocks |
| `PROTECTED_TOKENS_NOT_RESTORED` | `__WPO_PV_` tokens remain in output |
| `HEADINGS_MISSING` | < 40% of source headings found in translation |
| `TABLE_SHAPE_MISMATCH` | Column or row counts changed |
| `TABLE_COUNT_DROPPED` | Fewer tables in translation than source |

---

## DB fields

| Column | Content |
|---|---|
| `translations.translated_markdown` | Final restored markdown (after structural review) |
| `translations.translated_docx_key` | R2 key → `…/translator_draft.docx` |
| `translations.translated_preview_pdf_key` | R2 key → `…/preview.pdf` |
| `translations.translated_pdf_key` | Same as preview PDF (null if preview failed) |
| `translations.qa_report` | JSON: QA checks + source warnings |
| `translations.translated_ast` | Background AST enrichment (not used for rendering) |

`translated_docx_key` always ends in `.docx`.  `translated_preview_pdf_key` always ends in `.pdf` or is null.  The DOCX path is never stored as a PDF key.

---

## Known limitations

1. **No page-level OCR quality** — a single low-quality page within a good document passes the quality gate.
2. **Vision per-page limit** — very long documents (> 50 pages) may hit Anthropic rate limits.  Fallback to OCR elements is silent.
3. **Structural review is one-pass** — only headings and KV labels are reviewed; body text structural errors are not caught.
4. **Table shape check is column/row count only** — column content reordering or merged cells are not detected.
5. **Working-day check uses Mon–Fri only** — Kazakhstan public holidays are not accounted for (by design — the warning message explicitly notes this).
6. **Preview PDF requires Puppeteer** — if Puppeteer is unavailable on Railway, no preview PDF is generated and the translator receives DOCX only.
7. **Google Drive is optional** — if Drive env vars are absent, the 02_AI_DRAFT upload is silently skipped.
8. **Output is not guaranteed for acceptance by any third party.** The DOCX is a translator working draft, not a finished certified document.
