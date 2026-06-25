---
context_type: meta
risk_level: low
read_when:
  - any non-trivial task
  - selecting which context files to load
do_not_read_for:
  - trivial one-liner fixes with no cross-cutting risk
related:
  - ./CONTEXT_MANIFEST.md
  - ./INDEX.md
---

# Context Router

This file routes task types to the smallest required context set.

## Retrieval Algorithm

For every non-trivial task:

1. Classify the task domain using the routing table below.
2. Read only the required context files for that domain.
3. Read optional files only if the task touches those areas.
4. Use `rg` / exact search before opening large files.
5. For high-risk areas, use codebase-memory-mcp before editing.
6. Do not read all context docs by default.

**For ambiguous tasks** where domain classification is unclear, run the context suggester before loading any domain docs:
```bash
npx tsx scripts/context/suggest-context.ts "<task description>"
```

**Before committing context-system or high-risk code changes**, run the pre-commit guard:
```bash
npx tsx scripts/context/pre-commit-context-check.ts
```
This runs `check-context.ts` automatically when context files changed, and warns when high-risk files changed without context doc updates.

## Context Budget

Default maximum initial context:
- `CLAUDE.md`
- `PROJECT_CONTEXT.md`
- `docs/ai-context/INDEX.md`
- `docs/ai-context/CONTEXT_ROUTER.md`
- up to **3 primary domain docs**
- up to **2 secondary docs** only when justified

If more docs are needed, explain why before loading them.

## Routing Table

| Task domain | Primary docs | Secondary docs | Mandatory tools/checks | Notes |
|---|---|---|---|---|
| Branching / deployment / production promotion | `10_BRANCH_DEPLOYMENT_RULES.md`, `90_SECURITY_INVARIANTS.md` | `20_COMMANDS_AND_TESTS.md` | pre-task git check | Production requires exact approval phrase. |
| Payments / Halyk ePay / checkout / payment callbacks | `50_PAYMENTS_FINANCE_FISCALIZATION.md`, `90_SECURITY_INVARIANTS.md`, `95_CODEBASE_MEMORY_MCP_RULES.md` | `70_DATABASE_AND_API_SURFACE.md`, `30_ARCHITECTURE_OVERVIEW.md` | codebase-memory-mcp first | Never trust client-provided amounts. |
| Pricing / quotes / unit economics / cost reservations | `50_PAYMENTS_FINANCE_FISCALIZATION.md`, `95_CODEBASE_MEMORY_MCP_RULES.md` | `70_DATABASE_AND_API_SURFACE.md`, `90_SECURITY_INVARIANTS.md` | codebase-memory-mcp first | Quotes are immutable once payable/paid. |
| Fiscalization / Webkassa / manual receipts / refunds | `50_PAYMENTS_FINANCE_FISCALIZATION.md`, `90_SECURITY_INVARIANTS.md` | `70_DATABASE_AND_API_SURFACE.md`, `20_COMMANDS_AND_TESTS.md` | codebase-memory-mcp first | Fiscalization is non-blocking and idempotent. |
| OCR / translation / DOCX / PDF rendering / QA | `40_TRANSLATION_PIPELINE.md`, `30_ARCHITECTURE_OVERVIEW.md`, `95_CODEBASE_MEMORY_MCP_RULES.md` | `70_DATABASE_AND_API_SURFACE.md`, `docs/OFFICIAL_DOCX_PIPELINE_FREEZE.md`, `docs/OFFICIAL_TRANSLATION_PIPELINE.md` | codebase-memory-mcp first; check pipeline freeze | Do not modify frozen pipeline without explicit approval. |
| Official / notarized workflow | `40_TRANSLATION_PIPELINE.md`, `60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md`, `90_SECURITY_INVARIANTS.md` | `50_PAYMENTS_FINANCE_FISCALIZATION.md`, `70_DATABASE_AND_API_SURFACE.md` | codebase-memory-mcp first | Avoid claims of guaranteed acceptance or automatic notarization. |
| Jira / Google Drive / Telegram integrations | `60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md`, `90_SECURITY_INVARIANTS.md`, `95_CODEBASE_MEMORY_MCP_RULES.md` | `70_DATABASE_AND_API_SURFACE.md`, `30_ARCHITECTURE_OVERVIEW.md` | codebase-memory-mcp first | Never put sensitive data into Jira summaries/descriptions. |
| Database / Supabase / RLS / migrations | `70_DATABASE_AND_API_SURFACE.md`, `10_BRANCH_DEPLOYMENT_RULES.md`, `90_SECURITY_INVARIANTS.md` | `50_PAYMENTS_FINANCE_FISCALIZATION.md` if payments affected | migration destructive-op check | Never edit applied production migrations. |
| API routes / server actions | `70_DATABASE_AND_API_SURFACE.md`, `30_ARCHITECTURE_OVERVIEW.md` | domain-specific docs depending on route | rg exact route path | Use generated Supabase types. |
| i18n / legal / public content / refund/privacy/consent/disclaimer wording | `80_I18N_LEGAL_PUBLIC_CONTENT.md`, `90_SECURITY_INVARIANTS.md` | `30_ARCHITECTURE_OVERVIEW.md` | check all locale files | No AI certified / guaranteed acceptance claims. |
| Landing pages / marketing pages | `30_ARCHITECTURE_OVERVIEW.md`, `80_I18N_LEGAL_PUBLIC_CONTENT.md` | `PROJECT_CONTEXT.md` | check config-driven landing system | Do not duplicate section components. |
| Env vars / secrets / staging-production separation | `90_SECURITY_INVARIANTS.md`, `10_BRANCH_DEPLOYMENT_RULES.md`, `30_ARCHITECTURE_OVERVIEW.md` | `20_COMMANDS_AND_TESTS.md` | never print values | Report variable names only. |
| General small code fix | `30_ARCHITECTURE_OVERVIEW.md` only if architecture is unclear | domain doc only if touched | rg exact file/function names | Do not over-read context. |
| Context system maintenance | `96_CONTEXT_MAINTENANCE_RULES.md`, `DECISIONS.md`, `INDEX.md` | `CLAUDE.md` only if global agent rule changes | link check | Keep CLAUDE.md under 10k target. |
