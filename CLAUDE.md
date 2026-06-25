# CLAUDE.md — Bootloader

## 1. Read First (every session)

1. Read `PROJECT_CONTEXT.md` — authoritative for product vision, positioning, stack, env vars, pipeline, MVP status.
2. Read `docs/ai-context/INDEX.md` — domain router for detailed context files.

**Caveats on PROJECT_CONTEXT.md:**
- §6, §7, §18 describe TON payments as "implemented" — **outdated**. TON is fully removed. Current payment state: subscription active; Halyk ePay implemented but gated (`cardPaymentsActive = false`). See [50_PAYMENTS_FINANCE_FISCALIZATION.md](docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md).
- Everything else (vision, positioning, stack, env vars, pipeline) is accurate.

**DOCX / official translation pipeline freeze** — active since 2026-06-19. See `docs/OFFICIAL_DOCX_PIPELINE_FREEZE.md`. Do not modify OCR prompts, translation parameters, table-classification logic, or visual-element detection without explicit approval.

**Pipeline reference** — `tech-pipline` at repo root (untracked) has a Russian-language step-by-step breakdown. Read when debugging the DOCX output path.

Do **not** reposition WPO as a generic AI translator.

---

## 2. Low-token Context Retrieval

Do not read all context docs by default. After loading `PROJECT_CONTEXT.md` and `docs/ai-context/INDEX.md`, read `docs/ai-context/CONTEXT_ROUTER.md` and select the smallest relevant context set.

**Default initial budget:** up to 3 primary domain docs + up to 2 secondary docs when justified. Use exact search (`rg`) before opening large files. For high-risk code areas, follow `docs/ai-context/95_CODEBASE_MEMORY_MCP_RULES.md`.

- Context router: [docs/ai-context/CONTEXT_ROUTER.md](docs/ai-context/CONTEXT_ROUTER.md)
- Quick catalog: [docs/ai-context/CONTEXT_MANIFEST.md](docs/ai-context/CONTEXT_MANIFEST.md)

For ambiguous tasks, run `npx tsx scripts/context/suggest-context.ts "<task>"` to select the smallest context set. Before committing context-system or high-risk changes, run `npx tsx scripts/context/pre-commit-context-check.ts`.

---

## 3. Non-negotiable Safety Rules

These are always active — no exceptions without explicit written approval.

- **Never work directly on `main`.**
- **Never commit, push, merge, or deploy to production** without the user saying:
  > `Разрешаю продвигать staging в production`
- **Never print or commit secret values** — report variable names only.
- **Never point staging at production Supabase/R2** (or vice versa).
- **Never trust client-provided payment amounts** — always read from `price_quotes.amount_kzt`.
- **Never bypass `verifyQuotePayable()`** before initiating a payment transaction.
- **Never change payment/pricing/legal/tax/refund/notarization/official translation logic** without explaining blast radius first.
- **Never claim** "guaranteed accepted", "AI certified translation", or "automatic notarization".
- **Never put** document content, IIN/BIN, document numbers, payment credentials, or AI draft text into Jira issue summaries or descriptions.
- **If the user says "deploy", "push it", or "make it live"** without specifying staging or production — **ask before acting**.

---

## 4. Mandatory Pre-task Check

Before making any change, always run and report all three:

```bash
git branch --show-current
git status --short
git log -1 --oneline
```

---

## 5. Branch / Deployment Summary

| Branch | Environment | Deployed to |
|---|---|---|
| `main` | Production | Vercel Production + Railway production worker |
| `staging` | Staging | Vercel Preview + Railway staging worker |

- All regular work goes directly to `staging`.
- `feature/*` and `hotfix/*` branches are not used unless explicitly requested.
- Production promotion requires explicit approval + checklist (see [10_BRANCH_DEPLOYMENT_RULES.md](docs/ai-context/10_BRANCH_DEPLOYMENT_RULES.md)).

**End-of-task report** (after every task): current branch, files changed, commands run, test results, commit hash, next merge target, any required manual action in Vercel/Railway/Supabase/R2/payment systems.

---

## 6. Core Commands

### Web app (`/`)
```bash
npm run dev          # Next.js dev server
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run staging:check  # Validate env vars
```

### Worker (`/worker`)
```bash
cd worker
npm run dev          # tsx watch src/index.ts
npm run build        # tsc → dist/
npm run start        # node dist/index.js
npm run typecheck    # tsc --noEmit
npm run staging:check  # Validate worker env vars
```

### Tests (from repo root)
```bash
npm test
npx jest src/lib/translation-workflow
npx jest --testPathPattern qa
```

Full command list and helper scripts: [20_COMMANDS_AND_TESTS.md](docs/ai-context/20_COMMANDS_AND_TESTS.md)

---

## 7. Critical Architecture Pointers

- **Web app** — `src/` — Next.js 15 App Router on Vercel
- **Worker** — `worker/` — standalone Node.js on Railway (Docker)
- Shared: Supabase DB + Cloudflare R2 (independent env configs)
- Two separate job processors — do not conflate them (web app: HTML-only; worker: PDF/DOCX/full pipeline)
- Several modules are duplicated between web/worker and must be kept in sync manually
- `customer-order-state.ts` is the canonical function for all customer-visible order state — never duplicate it

Full details: [30_ARCHITECTURE_OVERVIEW.md](docs/ai-context/30_ARCHITECTURE_OVERVIEW.md)

---

## 8. Context Map

Load the relevant file for your task before touching code:

| Task | Context file |
|---|---|
| Branch, git, deploy, DB migrations | [10_BRANCH_DEPLOYMENT_RULES.md](docs/ai-context/10_BRANCH_DEPLOYMENT_RULES.md) |
| Commands, tests, helper scripts | [20_COMMANDS_AND_TESTS.md](docs/ai-context/20_COMMANDS_AND_TESTS.md) |
| Routing, processors, upload flow, landing pages, env, shadcn, Sentry | [30_ARCHITECTURE_OVERVIEW.md](docs/ai-context/30_ARCHITECTURE_OVERVIEW.md) |
| OCR, translation, DOCX/PDF, QA, visual elements, prompt system | [40_TRANSLATION_PIPELINE.md](docs/ai-context/40_TRANSLATION_PIPELINE.md) |
| Payments, Halyk ePay, quotes, fiscalization, refunds | [50_PAYMENTS_FINANCE_FISCALIZATION.md](docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md) |
| Jira, Google Drive, Telegram, staff profiles | [60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md](docs/ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md) |
| Database schema, API routes | [70_DATABASE_AND_API_SURFACE.md](docs/ai-context/70_DATABASE_AND_API_SURFACE.md) |
| i18n strings, legal documents, public/consent text | [80_I18N_LEGAL_PUBLIC_CONTENT.md](docs/ai-context/80_I18N_LEGAL_PUBLIC_CONTENT.md) |
| Security, secrets, data isolation | [90_SECURITY_INVARIANTS.md](docs/ai-context/90_SECURITY_INVARIANTS.md) |
| Codebase-memory-mcp queries | [95_CODEBASE_MEMORY_MCP_RULES.md](docs/ai-context/95_CODEBASE_MEMORY_MCP_RULES.md) |
| Context maintenance rules, end-of-task update checklist | [96_CONTEXT_MAINTENANCE_RULES.md](docs/ai-context/96_CONTEXT_MAINTENANCE_RULES.md) |
| Permanent architectural/product/ops decisions | [DECISIONS.md](docs/ai-context/DECISIONS.md) |
| Task-domain routing, low-token retrieval | [CONTEXT_ROUTER.md](docs/ai-context/CONTEXT_ROUTER.md) |
| Quick catalog of all context files | [CONTEXT_MANIFEST.md](docs/ai-context/CONTEXT_MANIFEST.md) |

---

## 9. Context Maintenance

At the end of every non-trivial task, perform a **Context Maintenance Check**:

- Did the task change architecture, workflow, security rules, payment logic, deployment process, database/API surface, or product positioning?
- Did it introduce a new permanent decision, invariant, or operational procedure?
- Did it make any existing context doc outdated?

If yes → update the relevant `docs/ai-context/*.md` file. If a permanent decision was made → add it to `docs/ai-context/DECISIONS.md`.

**Update `CLAUDE.md` only** for global agent operating rules that must load every session. Target: under 10,000 chars. Hard ceiling: 15,000 chars unless explicitly approved.

Include in every non-trivial end-of-task report:
```
Context maintenance:
- Context docs updated: yes/no
- Files updated: <list or "none">
- Reason: <why updated or why not needed>
- CLAUDE.md updated: yes/no
- Reason: <why>
```

Full rules: [96_CONTEXT_MAINTENANCE_RULES.md](docs/ai-context/96_CONTEXT_MAINTENANCE_RULES.md)

---

## 10. Codebase Memory MCP (compact)

Use codebase-memory-mcp as the **first step** before non-trivial analysis or code changes. Required workflow:

1. Use MCP to find affected files, symbols, routes, call chains.
2. Explain blast radius and risks.
3. Read exact files.
4. Propose the patch.
5. Do not edit until affected flow and risk points are clear.

**Always use before touching:** pricing/quote engine, Halyk payment flow, payment_transactions, Jira, Google Drive, Supabase order/payment/document logic, PDF/DOCX generation, i18n/legal/public texts, staging/production separation, worker processing, R2 upload/download, client document handling.

Full rules: [95_CODEBASE_MEMORY_MCP_RULES.md](docs/ai-context/95_CODEBASE_MEMORY_MCP_RULES.md)
