# Translation Pipeline

> **PIPELINE FREEZE ACTIVE** as of 2026-06-19. See `docs/OFFICIAL_DOCX_PIPELINE_FREEZE.md`.
> Do not modify OCR prompts, translation parameters, table-classification logic, or visual-element detection without explicit approval.
> **Approved exception (2026-07-02):** the "Translator/provider block" listed as frozen was explicitly approved for removal from automatic output — see "Electronic output policy" below. OCR, translation prompts/parameters, and visual-element detection were NOT touched.

## Electronic output policy (2026-07-02)

**Client-facing output formats for `electronic` service level are DOCX and HTML only — never PDF.** Official (`official_with_translator_signature_and_provider_stamp`) and notarization (`notarization_through_partners`) workflows are unchanged: AI draft DOCX → human review → final PDF/notary package, produced by the human/operator process, not the algorithm.

Enforced at the rendering boundary (the single authoritative point, not scattered across every upload path):
- `worker/src/processor.ts` — branch "4b. Normal mode (translation_only)": `outputFormat === 'html'` → HTML; everything else (`docx`, legacy/unrecognized, including stale `|pdf`-suffixed rows already in the queue) → DOCX. The Puppeteer/`generatePdfFromHtml()` PDF path was removed from this branch — it remains used for the official/notarized **preview PDF** in branch "4a" (an internal reviewer artifact, not a client deliverable).
- `src/lib/jobs/processor.ts` — the lightweight Vercel processor, which only ever handles `serviceLevel === 'electronic'`: same DOCX/HTML split. `renderToPdfBuffer()` (`src/lib/pdf/renderer.ts`, a real pdf-lib PDF generator) is no longer called from this path but is not deleted.
- `src/app/[locale]/dashboard/page.tsx` — the upload/order-configuration output-format `<select>` no longer offers a PDF `<option>`; default changed from `pdf` to `docx`.

**Auto-generated translator/executor block removed for ALL service levels** (electronic, official, notarization) — it is now filled in by the human translator/operator during finalization, not fabricated by the AI renderer:
- `worker/src/lib/docx-renderer.ts` — `BLOCK_MODES` (previously `{translator_review_draft, notarization_package}`) is now empty; `renderTranslatorProviderBlock()` and `TRANSLATOR_BLOCK_I18N` are kept intact, just never auto-invoked.
- `worker/src/lib/renderer.ts` and `src/lib/pdf/renderer.ts` — `showCert` is now hardcoded `false` in every render function; `buildCertificationBlockHtml()`/`certificationRows()` kept intact, never auto-invoked. The unrelated general notarization-process note (`notarizationNote()` / `showNotarNote`) is untouched.

**Not touched:** the visual/non-text elements block (`ensureVisualElementsBlock()`, `docx-visual-block.ts`) — a separate, unrelated feature that must remain exactly as-is.

Localized electronic-output disclaimer: `electronicOutput.formats.{title,body}` i18n keys in `messages/{locale}/order.json`, all 14 locales in `src/i18n/locales.ts`. Shown in the dashboard upload/order-configuration form, the pre-payment quote summary, and the post-completion download section (all gated on `serviceLevel === 'electronic'`). The Railway worker's completion email (`sendTranslationReady`, `worker/src/lib/email.ts`) has no i18n system at all (hardcoded English-only for every locale, a pre-existing limitation) — the disclaimer was not added there to avoid either hardcoding new text or building new i18n infrastructure as an undocumented side effect of this change.

## Full pipeline (Railway worker)

```
OCR (Mistral) → page-vision analysis → merge visual elements
  → protect critical identifiers → translate → restore identifiers
  → render HTML with visual-elements block → QA check
  → Puppeteer PDF or DOCX → upload to R2
  → upsert translations (with qa_report) → email
```

See `docs/OFFICIAL_TRANSLATION_PIPELINE.md` for full step-by-step call graph.

## translation-workflow module

`src/lib/translation-workflow/` (re-exported from its `index.ts`) drives all post-OCR logic. Its counterpart lives at `worker/src/lib/` with matching files.

### Shared types (`types.ts`)

`OutputMode`, `OutputPlan`, `VisualElement`, `VisualElementKind`, `TranslationQaReport`

### output-plan.ts

`computeOutputPlan(serviceLevelOrNotarized)`: accepts a `ServiceLevel` string (canonical) or a legacy boolean.
- `electronic` → `translation_only` (final PDF, released immediately)
- `official_with_translator_signature_and_provider_stamp` → `translator_review_draft` (DOCX + preview PDF, `workflow_status: awaiting_translator_review`, not released)
- `notarization_through_partners` → `notarization_package` (same artifacts, also requires notary review)

`deriveBackcompatBooleans(level)` converts a `ServiceLevel` back to legacy `{notarized, bureau_stamp}` for backward-compat DB queries — use it only for old queries, not new code.

### visual-elements.ts

`extractVisualElementsFromTranslated(markdown)` and `mergeVisualElements(ocr, translated)` collect stamps, signatures, QR codes, MRZ lines, etc.

**Priority order for visual element detection:**
1. `page-vision.ts` (Claude full-PDF vision — primary, returns most complete set)
2. Mistral OCR embedded images
3. Bracket markers in translated markdown (fallback only)

If page-vision returns ≥1 element, OCR markers are skipped entirely.

### visual-elements-block.ts

Renders the collected visual elements into an HTML block appended to the translated document (HTML renderer path only).

### customer-order-state.ts

`getCustomerOrderState(input)` is the **canonical** function for all customer-visible order state. Returns `{ customerStatus, canDownload, isActive, isTerminal, stages, progressPercent }`.

**Never duplicate this logic in components — always import from here.**

`CustomerStatus` covers the full lifecycle including notarization states: `queued`, `ocr_in_progress`, `translation_in_progress`, `pdf_rendering`, `awaiting_translator_review`, `translator_approved`, `awaiting_signature_stamp`, `assigned_to_notary`, `notarization_in_progress`, `notarized`, `ready_for_delivery`, `ready_for_pickup`, `out_for_delivery`, `delivered`, `picked_up`, `translator_declined`, `notary_declined`, `completed`, `failed`, `operator_processing`.

Used by `GET /api/jobs` and download gating.

## Worker-only modules (no `src/lib/` counterpart)

### page-vision.ts (`worker/src/lib/page-vision.ts`)

Sends the full raw PDF buffer to Claude as a document block for visual-element detection. This is PRIMARY; Mistral OCR image extraction is the fallback. Non-blocking — failure returns `[]` and the pipeline continues.

### protected-values.ts (`worker/src/lib/protected-values.ts`)

Extracts critical document identifiers (IBANs, BINs/IINs, passport numbers, SWIFT codes, reference codes) from the markdown before LLM translation and replaces them with opaque `{{V0001}}`-style tokens. Tokens are restored verbatim after translation, preventing any alteration of numeric/alphanumeric identifiers.

### docx-visual-block.ts (`worker/src/lib/docx-visual-block.ts`)

DOCX-native visual elements block renderer. Used by `docx-renderer.ts` instead of the HTML `visual-elements-block.ts`. Contains `VISUAL_BLOCK_I18N` with localized column headings for all supported target languages.

### qa.ts

`runQaChecks(html, mode)` returns a `TranslationQaReport`: checks for forbidden technical terms (`Claude`, `Mistral`, `JSON`, `Markdown`, `renderer`, etc.), broken glyphs, table clipping risk, orphan headings, presence of translator/verification blocks. A `qa_report` JSON is stored in the `translations` table.

## Translation prompt system

`src/lib/translation-prompts/` assembles per-request prompts from three layers:

- **`base.ts`** — shared policies injected into every prompt: `OFFICIAL_VISUAL_ELEMENT_POLICY` (how to render stamps, signatures, QR codes, images) and `FIELD_VALUE_TRANSLATION_POLICY` (what to translate vs. protect verbatim, auto-source-language wording rules)
- **`document-prompts.ts`** — `DOCUMENT_TYPE_PROMPTS` record keyed by `DocumentType`, each with extra document-specific rules
- **`index.ts`** — `buildTranslationPrompt(params)` combines the above into `{ systemPrompt, userPrompt, expectedOutputFormat }`

### OutputMode options

- `clean_official_translation` (default)
- `mirror_layout_translation`
- `notarization_package`
- `presentation_translation` (auto-selected when `documentType === 'presentation'`)

### ServiceLevel options

- `electronic` (default)
- `official_with_translator_signature_and_provider_stamp`
- `notarization_through_partners`

### DocumentType values

`passport_id`, `diploma_transcript`, `contract`, `bank_statement`, `medical_document`, `employment_document`, `police_clearance`, `visa_documents`, `driver_license`, `presentation`, `other`

## Model references

Both processors use `claude-sonnet-4-5-20250929` via `@anthropic-ai/sdk` (constant `MODEL` in each file).

**Five `MODEL` constants to update when changing the model:**
- `src/lib/translation/translator.ts`
- `src/lib/translation/detect-language.ts`
- `worker/src/lib/translator.ts`
- `worker/src/lib/detect-language.ts`
- `worker/src/lib/page-vision.ts`

## Synced duplicates

Several modules are maintained as independent copies in both the web app and worker and must be kept in sync manually:
- `output-plan.ts`
- `visual-elements.ts`
- `qa.ts`
- `renderer.ts` / `renderer-helpers.ts`
- `docx-renderer.ts`

The worker copies have a comment pointing back to the canonical `src/lib/translation-workflow/` version. `docx-visual-block.ts` is worker-only — do not create a web app counterpart unless explicitly asked.
