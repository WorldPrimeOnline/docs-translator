# Context Maintenance Rules

## Purpose

The AI context system must stay current as the project evolves. After any non-trivial task, Claude must check whether the task introduced durable knowledge that should be written back into the repo documentation.

## End-of-task Context Maintenance Check

At the end of every non-trivial task, perform this check:

1. Did the task change architecture, workflow, integrations, security rules, deployment process, payment logic, pricing logic, fiscalization, refunds, legal/i18n content rules, official translation pipeline, database/API surface, or product positioning?
2. Did the task introduce a new permanent decision, invariant, constraint, risk, or operational procedure?
3. Did the task make any existing context doc outdated?
4. Does `docs/ai-context/INDEX.md` need a new or updated route?
5. Does `CLAUDE.md` need to change?

## What to update

Use this routing:

| Changed area | File to update |
|---|---|
| Product vision, positioning, MVP status, business constraints | `PROJECT_CONTEXT.md` |
| Branching, staging, production, deployment, migrations | `docs/ai-context/10_BRANCH_DEPLOYMENT_RULES.md` |
| Commands, tests, helper scripts | `docs/ai-context/20_COMMANDS_AND_TESTS.md` |
| Architecture, routing, processors, app/worker split, env validation | `docs/ai-context/30_ARCHITECTURE_OVERVIEW.md` |
| OCR, translation, DOCX/PDF, QA, visual elements, protected values, prompt system | `docs/ai-context/40_TRANSLATION_PIPELINE.md` |
| Payments, Halyk ePay, quote pricing, fiscalization, refunds, unit economics | `docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md` |
| Jira, Google Drive, Telegram, staff profiles, notifications, notary workflow | `docs/ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md` |
| Supabase tables and API routes | `docs/ai-context/70_DATABASE_AND_API_SURFACE.md` |
| i18n, legal, public content, checkout/refund/privacy/consent/disclaimer wording | `docs/ai-context/80_I18N_LEGAL_PUBLIC_CONTENT.md` |
| Security invariants and sensitive-data rules | `docs/ai-context/90_SECURITY_INVARIANTS.md` |
| Codebase Memory MCP usage | `docs/ai-context/95_CODEBASE_MEMORY_MCP_RULES.md` |
| Context update process itself | `docs/ai-context/96_CONTEXT_MAINTENANCE_RULES.md` |
| Permanent decisions and rationale | `docs/ai-context/DECISIONS.md` |

## When to update `CLAUDE.md`

Update `CLAUDE.md` only when the change is a global operating rule that Claude must load at the start of every session.

**Examples that justify updating `CLAUDE.md`:**
- New production safety rule
- New mandatory read-first file
- New global forbidden action
- New required pre-task or end-of-task check
- Changed production approval rule
- Changed context loading architecture

**Examples that do NOT justify updating `CLAUDE.md`:**
- New API route
- New database table
- New payment implementation detail
- New landing page
- New i18n key
- New helper script
- New integration detail
- Temporary bug note

Keep `CLAUDE.md` compact. **Target: under 10,000 characters. Hard ceiling: 15,000 characters** unless explicitly approved.

## Required end-of-task report addition

For every non-trivial task, include a section in the end-of-task report:

```
Context maintenance:
- Context docs updated: yes/no
- Files updated: <list or "none">
- Reason: <why the update was or was not needed>
- CLAUDE.md updated: yes/no
- Reason: <why>
```

If no context docs were updated, explain why the task did not introduce durable knowledge.

## Safety

- Never write secrets, real client document content, payment credentials, IIN/BIN, passport/document numbers, or private customer data into context docs.
- Do not use context docs as a task backlog. Use Jira/Confluence for operational task tracking.
- Context docs are version-controlled — treat them with the same care as code.
