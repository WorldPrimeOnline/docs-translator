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

---

## Partner client discount: data-driven, server-calculated, commission base after discount (2026-06-29)

**Decision:** Partner client discounts are configured per-partner in the DB (`client_discount_enabled`, `client_discount_type`, `client_discount_value`, `client_discount_min_order_amount`, `client_discount_max_amount`). No global discount for all partners.

**Server flow:** Upload-card route re-validates the ref code and recalculates the discount from the DB. `finalPriceKzt = basePreDiscountKzt − discountKzt`. Client can never submit discount amounts.

**Commission base:** `order_amount_kzt − client_discount_applied_kzt − pass_through_items`. Partner commission is always calculated on WPO's net revenue after the client discount is deducted.

**UI:** Dashboard has a visible promo code / partner code field pre-filled from localStorage captured ref. `POST /api/partners/validate-code` returns public discount info (never commission_rate). Client discount is applied only on the card-payment path (subscription orders have no per-order price).

**Scope:** No payout automation, no partner dashboard, no Telegram/email notifications, no multi-level referral, no anti-spam.

---

### 2026-06-29 — Partner approval flow: operator-only, CRON_SECRET auth, code auto-generation

**Decision:**
Active partner records can only be created by an operator via `POST /api/admin/partners/approve-application`. No public endpoint or background process creates partners. The only auth mechanism for admin partner routes is `Authorization: Bearer ${CRON_SECRET}` (same pattern as cron routes). No additional admin auth system was added.

**Partner approval flow:**
1. Application arrives via `POST /api/partners/apply` (public) → `partner_applications.status = 'pending'`
2. Operator reviews at `/{locale}/admin/partners` (client-side page, auth via CRON_SECRET in sessionStorage)
3. Operator submits approval form → `POST /api/admin/partners/approve-application` → creates `partners` row + updates application to `approved`
4. Referral code auto-generated from `organization ?? name` (uppercase, non-alphanumeric stripped, max 10 chars + 4-char random suffix). Operator can override.
5. `partner_applications.approved_partner_id/at/by` written for audit trail.

**Rationale:**
No full admin auth system exists. CRON_SECRET bearer reuses existing pattern without new env vars. Simple code generation avoids manual entry errors while allowing operator override. Uniqueness collision is handled by a retry with extended suffix.

**Impacted files/docs:**
`src/app/api/admin/partners/approve-application/route.ts`, `src/app/api/admin/partners/applications/route.ts`, `src/app/[locale]/admin/partners/page.tsx`, `supabase/migrations/0033_partner_approval_discount_fields.sql`, `src/types/supabase.ts`, `docs/ai-context/70_DATABASE_AND_API_SURFACE.md`

---

### 2026-06-29 — Discount applied to price_quotes.amount_kzt (fixes Halyk payment amount bug)

**Decision:**
Before calling `saveQuote()` in `upload-card/route.ts`, `pricingResult.amountKzt` is patched to `finalPriceKzt` when a discount applies. This ensures `price_quotes.amount_kzt` (what Halyk ePay actually charges) equals the discounted price.

**Bug that was fixed:**
Without this patch, `price_quotes.amount_kzt` stored the pre-discount base price. `HalykPayButton` uses `quoteAmountKzt` from the quote, so customers would have been charged full price regardless of discount code.

**Discount audit trail:**
`jobs.price_kzt` = final post-discount price. `jobs.price_before_discount_kzt` = original price (null if no discount). `jobs.discount_applied_kzt` = KZT savings (null if no discount). `jobs.discount_code` = ref code that generated discount. Migration `0033`.

**Impacted files/docs:**
`src/app/api/documents/upload-card/route.ts`, `src/app/api/jobs/route.ts`, `src/app/api/jobs/[jobId]/route.ts`, `src/app/[locale]/dashboard/page.tsx`, `supabase/migrations/0033_partner_approval_discount_fields.sql`

---

### 2026-06-29 — Jira is the operator UI for partner activation (remove website admin cabinet)

**Decision:**
Partner approval and cancellation happen exclusively through Jira workflow transitions, not through a website admin cabinet. The `/admin/partners` page and `/api/admin/partners/approve-application` + `/api/admin/partners/applications` routes were removed. Active partners can only be created via the `POST /api/webhooks/jira/partnership` webhook (authenticated via `JIRA_WEBHOOK_SECRET`).

**Business flow:**
1. Partner submits form → saved in `partner_applications` + Jira Partnership issue created.
2. Operator transitions Jira issue to "АКТИВНОЕ ПАРТНЁРСТВО" → webhook creates partner.
3. Operator transitions to "ПАРТНЁРСТВО ОТМЕНЕНО" → webhook deactivates partner.

**Auth pattern:**
`x-wpo-webhook-secret: ${JIRA_WEBHOOK_SECRET}` (same pattern as the order webhook).

**No browser admin panel.** No CRON_SECRET login in browser. Jira is the only activation UI.

**Default commercial settings on activation (final as of 2026-06-30):**
`commission_rate = 0.10` (org types) or `0.05` (translator/notary/other), `client_discount_enabled = true`, `client_discount_type = 'percent'`, `client_discount_value = 10`, `client_discount_min_order_amount = 0`, `client_discount_max_amount = null`.
Meaning: 10% off any order (no min, no cap). See "2026-06-30 — Partner program: aggressive marketing model" decision below.

**Deactivation is non-destructive:** `is_active = false`, sets `deactivated_at` + `deactivation_reason`. Partner row, referrals, and orders preserved.

**Impacted files/docs:**
`src/app/api/webhooks/jira/partnership/route.ts`, `supabase/migrations/0034_partner_deactivation_fields.sql`, `docs/JIRA_AUTOMATION_SETUP.md`, `docs/ai-context/70_DATABASE_AND_API_SURFACE.md`. Removed: `src/app/[locale]/admin/partners/`, `src/app/api/admin/partners/`.

---

### 2026-06-30 — Partner economics correction: referral codes are attribution by default

**Decision:**
Partner referral codes are attribution codes, not automatic client discount codes. The default activation settings now create partners with `client_discount_enabled = false` and all discount fields null.

**Rationale:**
Partner commission is already baked into the WPO commercial price model (replaces most of the marketing/CAC reserve). Automatically granting a client discount on top creates a double cost: commission out + discount given to client. This is economically incorrect for the default case.

Two partner models are supported:
- **Referral model** — client pays normal retail price; partner earns commission after paid/completed order; `client_discount_enabled = false`.
- **Reseller model** — partner gets closed/wholesale price (12–15% below retail) and sets their own client price; no additional referral commission. (Not yet fully implemented; managed manually by operator.)

**What changed:**
- `DEFAULT_DISCOUNT_ENABLED = false`, `DEFAULT_DISCOUNT_TYPE = null`, `DEFAULT_DISCOUNT_VALUE = null`, `DEFAULT_DISCOUNT_MIN_ORDER = null` in the partnership webhook.
- Migration 0036 resets all staging/production partners where discount matches the old automatic default (fixed 1000 ₸, min 5000 ₸, no cap).
- `GET /api/partners/validate-code` already returned `discountEnabled: false` correctly; no change.
- Dashboard UI now shows "Код партнёра применён / Заказ будет привязан к партнёру WPO." for attribution-only codes (no discount), and discount amount only when explicitly configured.
- Jira activation comment now says "Скидка клиенту: не применяется по умолчанию" by default; shows actual discount terms only if explicitly enabled.
- `upload-card` logic was already correct: discount only applied when `client_discount_enabled = true`; partner referral always created regardless.

**Pricing model (correct):**
Final price = min check + word_count × rate + layout + human review + translator signature + provider stamp + notary + urgency + acquiring/tax/ops reserve + partner commission.
Partner commission **replaces** most marketing/CAC reserve (marketing reserve should be 0–2% when a partner code is present).

**Commission base:** `order_amount_kzt − client_discount_applied_kzt − pass_throughs (notary_official_fee, delivery_fee)`.
With `client_discount_applied_kzt = 0` (default), commission base = full paid amount minus pass-throughs.

**Impacted files:**
`src/app/api/webhooks/jira/partnership/route.ts`, `src/lib/jira/partner-client.ts`, `src/app/[locale]/dashboard/page.tsx`, `messages/*/order.json` (13 locales), `supabase/migrations/0036_partner_discount_default_correction.sql`, `docs/JIRA_AUTOMATION_SETUP.md`.

---

### 2026-06-30 — Partner economics correction #2: small default client incentive

**Decision:**
Partner codes now grant a small default client discount (5%, capped at 500 KZT, for orders ≥ 2500 KZT) on activation. This supersedes the "attribution-only by default" decision from earlier the same day.

**Rationale:**
Without a client incentive, clients have no motivation to enter the partner code manually. A 5% discount capped at 500 KZT is small enough to remain economically viable (given ~15–20% gross margin) while giving the client a concrete reason to enter the code.

**Commission base is after discount:**
`commission_base = order_amount_kzt − client_discount_applied_kzt − pass_throughs`.
Partner earns 5% of `commission_base`, not the full order amount.

**What changed:**
- `DEFAULT_DISCOUNT_ENABLED = true`, `DEFAULT_DISCOUNT_TYPE = 'percent'`, `DEFAULT_DISCOUNT_VALUE = 5`, `DEFAULT_DISCOUNT_MIN_ORDER = 2500`, `DEFAULT_DISCOUNT_MAX = 500` in partnership webhook.
- Migration 0037 applies new defaults to existing active attribution-only partners.
- Dashboard UI: shows "Скидка: {pct}%, но не более {max} ₸" + "При заказе от {min} ₸" hint.
- Jira activation comment: "Скидка клиенту: 5%, но не более 500 ₸, для заказов от 2 500 ₸".
- i18n: added `discountPercentCapped` and `discountMinOrderHint` keys in all 13 locales; updated `helperText` to mention discount.
- New pure helper `src/lib/partners/discount.ts` (`calculatePartnerDiscount`) — 18 unit tests.

**Impacted files:**
`src/app/api/webhooks/jira/partnership/route.ts`, `src/lib/jira/partner-client.ts`, `src/app/[locale]/dashboard/page.tsx`, `src/lib/partners/discount.ts`, `src/app/api/documents/upload-card/route.ts`, `messages/*/order.json` (13 locales), `supabase/migrations/0037_partner_discount_new_default.sql`, `docs/JIRA_AUTOMATION_SETUP.md`.

---

### 2026-06-30 — Partner program: aggressive marketing model (10% default, org commission 10%)

**Decision:**
Partner program is an aggressive marketing channel. Default client discount is 10% on any order (no minimum, no cap). Organization-type partners earn 10% commission; translator/notary/other earn 5%.

Partner channel replaces most paid marketing/CAC reserve:
- Partner orders: partner commission applies; marketing reserve = 0–2%.
- Direct orders: no commission; normal marketing reserve applies.

**Rationale:**
Previous 5%/min-2500/cap-500 default was too weak — small orders (e.g. 1100 KZT) showed no discount even when a partner code was accepted, giving clients zero motivation to enter codes. 10% with no minimum/cap is visible on every order, motivates code entry, and motivates partners to actively bring clients.

**Economic viability:**
10% discount + 10% commission = 20% gross cost. WPO margin is ~30–35% on translation services. After discount+commission the margin is ~10–15%, which is acceptable given zero paid CAC for partner-acquired orders.

**Commission base:** `order_amount_kzt − client_discount_applied_kzt − pass_throughs (notary_official_fee, delivery_fee)`.
Partner earns commission on WPO's net service revenue after discount.

**Org types (10% commission):** `agency`, `visa_center`, `migration_consultant`, `education_agency`, `legal_firm`, `corporate`.
**Non-org types (5% commission):** `translator`, `notary`, `other`.

**What changed:**
- `DEFAULT_DISCOUNT_VALUE = 10`, `DEFAULT_DISCOUNT_MIN_ORDER = 0`, `DEFAULT_DISCOUNT_MAX = null` in partnership webhook.
- `commissionRateForType(partnerType)` function: org → 0.10, other → 0.05.
- Migration 0038 updates existing partners from weak 5% defaults to 10%; updates org commission from 0.05 → 0.10.
- Active order card shows labeled lines: "Цена до скидки", "Скидка по коду", "К оплате".
- Jira client message: "...и получите скидку {value}% по партнёрскому коду...".
- i18n: updated `helperText` (mentions 10%), `discountPercent` format (colon, no minus), added `priceBeforeDiscount`/`discountByCode`/`finalPrice` in all 13 locales.

**Impacted files:**
`src/app/api/webhooks/jira/partnership/route.ts`, `src/lib/jira/partner-client.ts`, `src/app/[locale]/dashboard/page.tsx`, `src/lib/partners/__tests__/discount.test.ts`, `messages/*/order.json` (13 locales), `supabase/migrations/0038_partner_aggressive_defaults.sql`, `docs/JIRA_AUTOMATION_SETUP.md`.
