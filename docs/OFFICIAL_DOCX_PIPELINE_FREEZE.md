# Official DOCX Pipeline Freeze — Controlled Pilot

**Status:** Frozen for controlled production pilot as of 2026-06-19  
**Baseline tag:** `official-layout-v1-controlled-pilot`  
**Renderer version:** official-layout-v1

## What is frozen

- OCR provider and OCR prompt
- Translation prompt and model parameters
- Chunking logic
- Protected-values architecture
- Full-page visual element analysis (Claude vision)
- Visual kinds, deduplication, and localization
- Translator/provider block (i18n per target language)
- Job lifecycle and status transitions
- Jira/Google Drive integration workflow

## Permitted changes before ML engineer review

Only critical runtime failures that block job completion. No OCR, prompt, vision, or table-classification changes without a separate approved project.

## Approved exceptions to "Jira/Google Drive integration workflow"

- **2026-08-10** — explicit written approval to add exactly 3 new Jira custom fields (`customfield_10129/10130/10131`, Telegram Operations' payable page count / translator payout / notary payout) to the main order issue's create-payload in `worker/src/lib/integrations.ts` (`loadTelegramOpsPricingFields()`) and `worker/src/lib/jira/order-fields.ts` (`buildJiraIssueFields()`). Scoped narrowly: read-only, additive, no other Jira field, no OCR/translation/rendering logic, no `loadPriceBreakdownData()` change. See `docs/ai-context/DECISIONS.md` (2026-08-10 entry) and `docs/TELEGRAM_OPERATIONS_SETUP.md`.

## Current layout (official-layout-v1)

- 2-column key-value tables (label 33% / value 67%) with localized "Field | Value" header
- 4-column packed KV tables from LLM are automatically unpacked to 2 columns
- Data tables (income, schedules, multi-column) keep their original column count
- 4-column visual element block (Page | Element | Position | Representation)
- 2-column translator/provider certification block
- Deterministic localized translation heading (e.g., "TRADUZIONE DAL RUSSO ALL'ITALIANO")
- Real PAGE / NUMPAGES footer fields (LibreOffice-renderable)
- Compact page margins: 0.80 in top/bottom, 0.72 in left/right
- Print-safe borders: outer 6pt, inner 4pt, black (#000000)

## Translator responsibilities

Translators are responsible for:

- Linguistic accuracy and terminology review
- Identifier verification (BIC, IIN, account numbers)
- Final formatting adjustments in the certified copy
- Stamping and signing the printed document
