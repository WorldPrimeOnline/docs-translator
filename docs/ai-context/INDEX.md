# AI Context Index

## How this system works

| File | Role |
|---|---|
| `CLAUDE.md` | **Bootloader** — safety rules, mandatory checks, core commands, context map. Read every session. |
| `PROJECT_CONTEXT.md` | **Product source of truth** — vision, positioning, stack, env vars, MVP status. Always authoritative. |
| `docs/ai-context/*` | **Operational memory** — detailed rules, architecture, and constraints by domain. |

## Context loading rules

Read `CLAUDE.md` and `PROJECT_CONTEXT.md` at the start of every session.
For PROJECT_CONTEXT.md caveats (TON payments, pipeline freeze, positioning): [00_CONTEXT_LOADING_RULES.md](./00_CONTEXT_LOADING_RULES.md).

**For non-trivial tasks, do not read every context file.** Use [CONTEXT_ROUTER.md](./CONTEXT_ROUTER.md) to select the smallest relevant context set, then use exact search (`rg`) to locate code/docs details. Use [CONTEXT_MANIFEST.md](./CONTEXT_MANIFEST.md) to quickly identify which file covers an area.

For any task, load the relevant domain file before touching code:

| Task | Read first |
|---|---|
| PROJECT_CONTEXT.md caveats, pipeline freeze, `tech-pipline` reference | [00_CONTEXT_LOADING_RULES.md](./00_CONTEXT_LOADING_RULES.md) |
| Branch, git, deploy, migration | [10_BRANCH_DEPLOYMENT_RULES.md](./10_BRANCH_DEPLOYMENT_RULES.md) |
| Running commands, tests, scripts | [20_COMMANDS_AND_TESTS.md](./20_COMMANDS_AND_TESTS.md) |
| Routing, upload flow, processors, landing pages, Sentry, shadcn | [30_ARCHITECTURE_OVERVIEW.md](./30_ARCHITECTURE_OVERVIEW.md) |
| OCR, translation, DOCX/PDF rendering, QA, visual elements, prompt system | [40_TRANSLATION_PIPELINE.md](./40_TRANSLATION_PIPELINE.md) |
| Payments, Halyk ePay, pricing quotes, fiscalization, refunds | [50_PAYMENTS_FINANCE_FISCALIZATION.md](./50_PAYMENTS_FINANCE_FISCALIZATION.md) |
| Jira, Google Drive, Telegram notifications, staff profiles | [60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md](./60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md) |
| Database schema, API routes | [70_DATABASE_AND_API_SURFACE.md](./70_DATABASE_AND_API_SURFACE.md) |
| i18n strings, legal documents, public/consent/disclaimer text | [80_I18N_LEGAL_PUBLIC_CONTENT.md](./80_I18N_LEGAL_PUBLIC_CONTENT.md) |
| Security, secrets, data isolation | [90_SECURITY_INVARIANTS.md](./90_SECURITY_INVARIANTS.md) |
| Codebase-memory-mcp usage | [95_CODEBASE_MEMORY_MCP_RULES.md](./95_CODEBASE_MEMORY_MCP_RULES.md) |
| Context maintenance rules, end-of-task update checklist | [96_CONTEXT_MAINTENANCE_RULES.md](./96_CONTEXT_MAINTENANCE_RULES.md) |
| Permanent architectural/product/ops decisions | [DECISIONS.md](./DECISIONS.md) |
| Task-domain routing, low-token retrieval algorithm | [CONTEXT_ROUTER.md](./CONTEXT_ROUTER.md) |
| Quick catalog of all context files | [CONTEXT_MANIFEST.md](./CONTEXT_MANIFEST.md) |

> **Context maintenance:** After any non-trivial task, check whether durable knowledge changed and update the relevant context file. See [96_CONTEXT_MAINTENANCE_RULES.md](./96_CONTEXT_MAINTENANCE_RULES.md).

## Key cross-cutting invariants (always active, regardless of task)

- Never work on `main` directly.
- Never print or commit secrets.
- Never trust client-provided payment amounts — always read from `price_quotes.amount_kzt`.
- Never claim "guaranteed accepted", "AI certified translation", or "automatic notarization".
- Never put IIN/BIN, document numbers, or payment credentials into Jira summaries/descriptions.
- DOCX/official pipeline is frozen — do not modify OCR prompts, translation parameters, table-classification logic, or visual-element detection without explicit approval.
