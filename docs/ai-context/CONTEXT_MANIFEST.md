---
context_type: meta
risk_level: low
read_when:
  - scanning for the right context file to load
  - unsure which domain file covers an area
do_not_read_for:
  - tasks with a clear domain already identified
related:
  - ./CONTEXT_ROUTER.md
  - ./INDEX.md
---

# Context Manifest

Short catalog of WPO AI context files. Use this to identify which file to load before opening anything.

| File | Covers |
|---|---|
| `00_CONTEXT_LOADING_RULES.md` | Read-first caveats, PROJECT_CONTEXT relationship, pipeline freeze, local `tech-pipline` note. |
| `10_BRANCH_DEPLOYMENT_RULES.md` | Staging/main rules, production approval, hotfix workflow, migrations, env separation, end-of-task report. |
| `20_COMMANDS_AND_TESTS.md` | Web/worker npm commands, Jest tests, helper scripts, reference env files. |
| `30_ARCHITECTURE_OVERVIEW.md` | Web/worker architecture, routing, upload flow, dual processors, document_type encoding, job status flow, landing pages, legal system, email, rate limiting, env validation, shadcn/ui, Sentry, code standards. |
| `40_TRANSLATION_PIPELINE.md` | OCR, translation, protected values, page-vision, visual elements, DOCX/PDF rendering, QA checks, prompt system, synced duplicates, five MODEL constants. |
| `50_PAYMENTS_FINANCE_FISCALIZATION.md` | Halyk ePay, quote-based pricing flow, subscription plans, fiscalization (Webkassa/manual), refunds, worker fiscal reconciliation. |
| `60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md` | Jira (one-issue-per-order architecture), Google Drive subfolders, Telegram broadcast + personal notifications, staff_profiles, notification_log, notary cities. |
| `70_DATABASE_AND_API_SURFACE.md` | All Supabase table schemas and full API route table. |
| `80_I18N_LEGAL_PUBLIC_CONTENT.md` | i18n sync rules, legal document system (7 types, 11 locales), prohibited claims, landing page content rules. |
| `90_SECURITY_INVARIANTS.md` | Secrets handling, staging/prod data isolation, payment integrity, Jira sensitive-data rules, LLM output validation. |
| `95_CODEBASE_MEMORY_MCP_RULES.md` | When and how to use codebase-memory-mcp; required workflow; trigger list. |
| `96_CONTEXT_MAINTENANCE_RULES.md` | When to update context docs and CLAUDE.md; end-of-task maintenance check; routing table for knowledge updates. |
| `DECISIONS.md` | Permanent architectural/product/ops decisions with rationale. |
| `CONTEXT_ROUTER.md` | Task-domain routing table and low-token retrieval algorithm. |
| `CONTEXT_MANIFEST.md` | This file — quick catalog for file selection. |
| `FRESHNESS_AUDIT.md` | When and how to run the context freshness audit; what each of the 12 checks covers. |
| `DECISION_CAPTURE.md` | When to record a decision, when not to, examples, and `add-decision.ts` command reference. |
