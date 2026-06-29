# Decisions

Permanent architectural, product, and operations decisions for WPO.

This file records decisions that should survive across sessions and explain why the project works this way.

## Format

Each decision uses:

### YYYY-MM-DD — Decision title

**Decision:**
...

**Rationale:**
...

**Impacted files/docs:**
...

**Risks / caveats:**
...

---

## Decisions

### 2026-06-25 — Context freshness is checked with deterministic repo-local audits

**Decision:**
`scripts/context/freshness-audit.ts` uses deterministic file/regex checks only — no vector search, no external APIs, no embedding models. It checks 12 specific claims about WPO product state against the source files that implement them.

**Rationale:**
WPO's high-risk claims are narrow and concrete (e.g. "cardPaymentsActive is false", "Halyk routes exist", "pipeline freeze doc is present"). A deterministic audit is faster, cheaper, offline-capable, and produces zero false positives from semantic drift. If a claim cannot be verified by a file-existence or regex check, it belongs in a code review, not a freshness audit.

**Impacted files/docs:**
- `scripts/context/freshness-audit.ts`
- `docs/ai-context/FRESHNESS_AUDIT.md`
- `docs/ai-context/96_CONTEXT_MAINTENANCE_RULES.md` (run rule)
- `docs/ai-context/CONTEXT_ROUTER.md` (post-change prompt)

**Risks / caveats:**
The audit checks file presence and regex patterns — it does not read or validate the full prose in context docs. A context doc that references a symbol correctly by name but describes its behaviour wrong will not be caught. Human review of changed context docs remains necessary after significant product decisions.

---

### 2026-06-25 — Pre-commit context guard uses a script, not a git hook

**Decision:**
The pre-commit context guard (`scripts/context/pre-commit-context-check.ts`) is run explicitly via `npx tsx`, not wired as a git hook. It is not added to `.husky/`, `.git/hooks/`, or `package.json` pre-commit scripts.

**Rationale:**
Git hooks require hook installation (e.g. `husky install`) which adds a setup step for every developer and CI environment. An explicit script is always available, can be inspected, can be bypassed intentionally, and has no installation friction. Claude is instructed to run it before committing context-system or high-risk changes.

**Impacted files/docs:**
- `scripts/context/pre-commit-context-check.ts`
- `docs/ai-context/96_CONTEXT_MAINTENANCE_RULES.md`
- `docs/ai-context/CONTEXT_ROUTER.md`

**Risks / caveats:**
A script that must be run manually can be forgotten. Mitigation: CLAUDE.md §2 and `96_CONTEXT_MAINTENANCE_RULES.md` both remind Claude to run it before committing context-system or high-risk changes. If the team later wants automatic enforcement, the script can be registered as a husky hook without modification.

---

### 2026-06-25 — AI context routing uses lightweight repo-local scripts, not a vector database

**Decision:**
The AI context retrieval system uses three lightweight `npx tsx` scripts (`check-context.ts`, `suggest-context.ts`, `search-context.ts`) in `scripts/context/`. No vector database, embedding store, or external service is used for context retrieval.

**Rationale:**
Deterministic keyword routing is sufficient for a focused codebase with stable, well-named domains. Vector search adds infrastructure complexity, requires embeddings to stay current, and introduces an external dependency that could fail silently. Repo-local scripts have zero cold-start cost, run without network access, and are auditable in version control.

**Impacted files/docs:**
- `scripts/context/check-context.ts`
- `scripts/context/suggest-context.ts`
- `scripts/context/search-context.ts`
- `docs/ai-context/CONTEXT_ROUTER.md`
- `docs/ai-context/20_COMMANDS_AND_TESTS.md`

**Risks / caveats:**
Keyword matching can miss novel task descriptions that don't use expected vocabulary. Mitigation: `suggest-context.ts` defaults to the `general_code` domain when no keywords match, and always includes the bootloader docs. The routing table in `CONTEXT_ROUTER.md` should be expanded as new domains emerge.

---

### 2026-06-25 — CLAUDE.md is a compact bootloader, not the full project knowledge base

**Decision:**
`CLAUDE.md` must stay compact and contain only global operating rules, critical safety constraints, mandatory read-first instructions, and the context map. Detailed knowledge lives in `PROJECT_CONTEXT.md` and `docs/ai-context/*.md`.

**Rationale:**
The previous `CLAUDE.md` exceeded 40,000 characters and mixed operational rules with detailed architecture documentation. Splitting the context into routed markdown files keeps startup context small while preserving detailed knowledge in version-controlled docs.

**Impacted files/docs:**
- `CLAUDE.md`
- `PROJECT_CONTEXT.md`
- `docs/ai-context/INDEX.md`
- `docs/ai-context/*.md`

**Risks / caveats:**
Claude must actually read `INDEX.md` and the relevant context files before risky work. The end-of-task context maintenance check (see `docs/ai-context/96_CONTEXT_MAINTENANCE_RULES.md`) is required to prevent the docs from becoming stale.

---

### 2026-06-25 — Permanent decisions are captured via add-decision.ts, not manual DECISIONS.md edits

**Decision:**  
All new permanent architectural/product/ops decisions must be appended to docs/ai-context/DECISIONS.md using scripts/context/add-decision.ts. Manual free-form edits to DECISIONS.md are discouraged.

**Rationale:**  
Manual edits have historically produced inconsistent formatting (missing trailing two-spaces on bold headers, inconsistent separators, raw meeting notes dumped as entries). The script enforces the required template, warns on duplicate titles, and blocks if secret-like strings are detected.

**Impacted files/docs:**  
scripts/context/add-decision.ts, docs/ai-context/DECISIONS.md, docs/ai-context/DECISION_CAPTURE.md, docs/ai-context/96_CONTEXT_MAINTENANCE_RULES.md, CLAUDE.md

**Risks / caveats:**  
Claude and engineers can still manually edit DECISIONS.md if the script is unavailable. The script does not validate existing entries — only new ones appended through it.

---

### 2026-06-26 — Price Breakdown Story is created at order init, Finance Report at completion

**Decision:**  
Two Jira Stories are linked to every certified/notarized order: (1) Price Breakdown Story created at order initialisation via createPriceBreakdownIssue() — contains client-visible line items only; (2) Finance Report Story created post-completion via createFinanceReportIssue() — contains internal unit economics. Controlled separately by JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED and the Finance Report is always attempted when Jira is configured.

**Rationale:**  
Separating the two issues by timing and audience prevents internal cost data from being visible to translators/notaries who see the main Jira issue, while giving operators an immediate price breakdown without waiting for order completion.

**Impacted files/docs:**  
worker/src/lib/jira/price-breakdown.ts, worker/src/lib/integrations.ts, supabase/migrations/0028_jobs_price_breakdown_jira.sql, docs/ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md

**Risks / caveats:**  
Price Breakdown is opt-in via feature flag. If the quote is not yet persisted when initializeOrderIntegrations runs, the breakdown will show null pricing — this is handled gracefully with a fallback message.

---

### 2026-06-28 — Partner Program MVP architecture and commission rules

**Decision:**  
Partner Program MVP ships as: (1) public /partners landing page with application form; (2) POST /api/partners/apply route saving to partner_applications table; (3) Jira issue created best-effort on submission; (4) referral capture via sessionStorage (ref+UTM) in ReferralCapture client component in locale layout; (5) four new Supabase tables: partner_applications, partners, partner_referrals, partner_payouts. Commission rules: orgs get 5%/7%/10% tiered by order volume; translator client referral 5%; translator acquisition 5k+10k KZT milestones. All commission calculated on WPO service income excluding pass-through costs. Minimum payout 10k KZT, monthly cadence.

**Rationale:**  
Partner program is a growth channel for WPO. MVP validates the model without building full payout automation. Jira non-blocking fallback ensures no application is lost due to Jira outage. Referral capture is foundation-only in MVP — wiring to order creation is deferred.

**Impacted files/docs:**  
`Not specified`

**Risks / caveats:**  
`Not specified`

---

### 2026-06-29 — Jira partner issue project key and type hardcoded, not env-driven

**Decision:**  
`src/lib/jira/partner-client.ts` uses hardcoded module-level constants `PARTNER_JIRA_PROJECT_KEY = 'WPO'` and `PARTNER_JIRA_ISSUE_TYPE = 'Partnership'`. Do NOT read from `JIRA_PARTNER_PROJECT_KEY` or `JIRA_PARTNER_ISSUE_TYPE` env vars. On first 400, the client retries without labels (handles Jira screen/field config restrictions). On success, `jira_issue_url` and `jira_created_at` are stored alongside `jira_issue_key`.

**Rationale:**  
Env var reads silently fell back to wrong defaults ('WO'/'Task'), causing every submission to fail Jira creation. Hardcoding eliminates the entire failure class. The correct project is WPO; Partnership is the correct issue type in that project. The label-retry pattern handles restrictive Jira field configurations without breaking the core flow.

**Impacted files/docs:**  
`src/lib/jira/partner-client.ts`, `src/app/api/partners/apply/route.ts`, `src/types/supabase.ts`, `supabase/migrations/0030_partner_applications_jira_fields.sql`, `docs/ai-context/70_DATABASE_AND_API_SURFACE.md`

**Risks / caveats:**  
If WPO ever changes the Jira project key or renames the issue type, this constant must be updated. Migration 0030 renames `jira_last_error` → `jira_error`; any admin tooling that queried the old column name must be updated.

---

### 2026-06-29 — Referral-to-order wiring: server-side only, best-effort, card payment auto-confirms

**Decision:**
Referral wiring is best-effort: failures never block order creation or payment. Client sends only `refCode` + UTMs; server reads `commission_rate` from `partners` table and calculates all commission amounts. Commission base = `order_amount_kzt` minus pass-through items (`notary_official_fee`, `delivery_fee`) from `price_quote_items`. Card payment orders auto-confirm via Halyk ePay callback. Subscription orders stay `pending` (no per-order KZT price; manual resolution or future batch process). `cancelReferral` is implemented but not yet wired — must be connected when admin refund route exits 501 placeholder.

**Rationale:**
Never trust client-supplied financial values. Referral logic must be invisible to order creation reliability. Subscription orders lack a clear per-order payment event, so deferring commission calculation is safer than guessing.

**Impacted files/docs:**
`src/lib/referral/server.ts`, `src/app/api/documents/upload-card/route.ts`, `src/app/api/documents/upload/route.ts`, `src/app/api/payments/halyk/callback/route.ts`, `src/app/[locale]/dashboard/page.tsx`, `supabase/migrations/0031_partner_referrals_ext.sql`, `docs/ai-context/30_ARCHITECTURE_OVERVIEW.md`, `docs/ai-context/70_DATABASE_AND_API_SURFACE.md`

**Risks / caveats:**
`cancelReferral` is not wired to the refund route (501). Referrals for refunded orders will stay `confirmed` until manually corrected or the admin refund route is enabled. Subscription referrals require manual or batch commission settlement.
