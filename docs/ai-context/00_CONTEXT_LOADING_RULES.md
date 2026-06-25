# Context Loading Rules

## Session start protocol

1. Read `CLAUDE.md` (bootloader — safety rules, mandatory checks).
2. Read `PROJECT_CONTEXT.md` (product source of truth).
3. Read `docs/ai-context/INDEX.md` (domain router).
4. Load the domain context file(s) relevant to the task at hand.

## PROJECT_CONTEXT.md caveats

- Sections §6, §7, and §18 describe TON cryptocurrency payments as "implemented" — **outdated**. TON payments are fully removed from the codebase.
- Current payment state: subscription-only active; Halyk Bank ePay fully implemented but gated by `cardPaymentsActive = false`.
- Everything else in `PROJECT_CONTEXT.md` (vision, positioning, stack, env vars, pipeline, MVP state) is accurate.

## DOCX / official translation pipeline freeze

Active as of **2026-06-19**. See `docs/OFFICIAL_DOCX_PIPELINE_FREEZE.md` for the exact allowed/disallowed list.

**Do not modify without explicit approval:**
- OCR prompts
- Translation parameters
- Table-classification logic
- Visual-element detection

## Pipeline reference

The file `tech-pipline` at the repo root (untracked) contains a detailed Russian-language step-by-step breakdown of the AI translation pipeline: OCR → protect values → translate → merge visuals → render DOCX/PDF → QA → integrations. Read it when debugging the DOCX output path.

## Positioning constraint

Do **not** reposition WPO as a generic AI translator. It is a certified/notarized document translation service for Central Asia, specifically Kazakhstan-focused.
