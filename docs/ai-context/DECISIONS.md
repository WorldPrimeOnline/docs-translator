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

---

## 2026-06-30 — Partner payout workflow: operator scripts, no bank automation

**Decision:** Monthly partner payout generation and marking is done via operator CLI scripts, not automatic bank transfers. Jira project `WPO` / issue type `Payout` are hardcoded (not env-configurable) — they are business rules.

**Payout status flow:**
- `partner_referrals`: `pending → confirmed → in_payout → paid` (also: `refunded | canceled`)
- `partner_payouts`: `pending_approval → paid` (or `rejected`)

**Jira routing (hardcoded):**
- `PARTNER_PAYOUT_JIRA_PROJECT_KEY = 'WPO'`
- `PARTNER_PAYOUT_JIRA_ISSUE_TYPE = 'Payout'`
- Do NOT move to env vars. These are business rules, not deployment config.

**Refunds after payout:** Not automatically handled. A referral that is `in_payout` or `paid` and then refunded requires manual accounting adjustment in the next payout cycle. Document risk, do not silently modify paid referrals.

**Commission base invariant:** Commission is always calculated on `commission_base_kzt` (post-discount, post-pass-through), never on gross `order_amount_kzt`. Enforced in `confirmReferral()` and `generateMonthlyPayouts()`.

**Operational commands:**
```
# Dry run (safe, no DB writes):
npm run partners:payouts -- --period-start=YYYY-MM-01 --period-end=YYYY-MM-DD --dry-run

# Generate payouts:
npm run partners:payouts -- --period-start=YYYY-MM-01 --period-end=YYYY-MM-DD

# Mark paid (after manual bank transfer):
npm run partners:mark-paid -- --payout-id=<uuid> --payment-reference="Halyk 2026-08-05"
```

**Impacted files:**
`supabase/migrations/0039_partner_payout_workflow.sql`, `src/lib/partners/generate-payout.ts`, `src/lib/partners/mark-payout.ts`, `src/lib/jira/payout-client.ts`, `scripts/partners/generate-monthly-payout.ts`, `scripts/partners/mark-payout-paid.ts`, `src/types/supabase.ts`, `src/lib/referral/server.ts` (adds `confirmed_at`), `package.json`.

---

### 2026-07-01 — Notarized orders and uncommon-but-known language pairs auto-quote; operator review no longer blanket-forced

**Decision:**  
calculatePrice() no longer forces requiresOperatorReview=true for every notarization_through_partners order, and resolveLanguageGroup() no longer forces it for every language pair outside the 16 named groups. Notary fee (MRP-based formula) and the 'other' pricing bucket are both fully computable, so standard checkout combinations (any UI-exposed document type x service level x delivery option, and any pair of recognized language codes) now get an automatic price_quotes row with status=quoted and can proceed straight to payment. Operator review is now reserved for genuinely exceptional inputs: unsupported/remote delivery zones, unknown applicant type, handwritten scans, presentation with unknown page count, and language codes that are not recognized at all (e.g. 'auto', empty, typos).

**Rationale:**  
Production/staging showed real orders (e.g. ru->en trudovoi dogovor / employment_document, notarized, delivery to Almaty) stuck on 'Tsena podtverzhdaetsya operatorom' even though every input was a standard, fully-priceable UI option. Root cause: calculator.ts unconditionally pushed a notarized-order review reason regardless of input, and config.ts forced review for any language pair combination not explicitly named even when both language codes were recognized and the 'other' rate bucket had full pricing data. Business rule: price must always be automatic for standard orders; operator involvement is for confirming translator/notary/courier availability and slots AFTER payment, never for gating whether a price is shown or checkout can start.

**Impacted files/docs:**  
src/lib/pricing/calculator.ts, src/lib/pricing/config.ts, src/app/api/documents/upload-card/route.ts, src/lib/pricing/__tests__/calculator.test.ts, docs/finance/PRICING_ENGINE.md

**Risks / caveats:**  
notary_official_fee remains an MRP-based ESTIMATE (see TODO in calculator.ts) not yet confirmed line-by-line with the notary partner; customers are now charged this estimate automatically before any human check. If the estimate is materially wrong for a given case, it must be corrected via a pricing_versions update or a refund/adjustment, not by re-introducing a blanket operator-review gate. No DB migration was needed; price_quotes.status enum and verifyQuotePayable() were unchanged — the latter already allowed paying requires_operator_review quotes, so this change only affects what customers are shown, not payment-layer permissions.

---

### 2026-07-02 — Internal AI Translation Test Lab is isolated from payment/order/Jira workflow

**Decision:**  
tools/internal-ai-test-lab/run-ai-translation-test.ts is a CLI-only tool that runs the real OCR/translation/render/pricing pipeline against a local document for internal algorithm and pricing testing. It may run against production services only with explicit guards (AI_TRANSLATION_TEST_LAB_ENABLED=true, AI_TRANSLATION_TEST_LAB_ALLOW_PRODUCTION=true, and --confirm-production on the command line; it also fails hard if ALLOW_STAGING_PAYMENT_OVERRIDE=true is set in production). It is not a payment bypass and must never be treated as one. It must never call Halyk, Webkassa/OFD, Jira, Google Drive, Telegram, or Resend, and must never create normal jobs/documents/translations rows or write to payment_transactions, fiscal_receipts, refund_transactions, price_quotes, price_quote_items, or cost_reservations. Pricing is computed via the real computeQuoteForJob() (src/lib/pricing/service.ts), which only reads pricing_versions and never calls saveQuote(); this tool exercises OCR/AI translation/rendering/pricing only. All run outputs are internal test artifacts (watermarked INTERNAL TEST — NOT CLIENT ORDER — NOT PAID — NOT FOR DELIVERY) and are never client deliverables.

**Rationale:**  
Testing the real pipeline previously required creating a real job, which triggers Jira issue creation, Google Drive folders, Telegram notifications, and (once Halyk is live) a real payment. A production-safe, side-effect-free test boundary was needed so the algorithm and pricing engine can be exercised against production/staging services without polluting the normal customer/finance/integration surface. See tools/internal-ai-test-lab/README.md and __tests__/no-forbidden-integrations.test.ts, which statically asserts this isolation.

**Impacted files/docs:**  
`tools/internal-ai-test-lab/` (new), `docs/ai-context/20_COMMANDS_AND_TESTS.md`, `.gitignore`, `package.json`, `jest.config.ts`, `tsconfig.json` (excludes `tools/`, which has its own `tools/internal-ai-test-lab/tsconfig.json` + `npm run wpo:ai-test:typecheck`)

**Risks / caveats:**  
This tool imports the same `worker/src/lib/*` modules the Railway worker uses, so a bug in this tool's argument handling could still consume real Mistral/Anthropic API spend against production credentials if misconfigured — the production guard (env flags + `--confirm-production`) is the only thing preventing that, not a hard technical sandboxing boundary. It never calls `saveQuote()`, so pricing runs never appear in `price_quotes`/operator tooling — do not use its output as a substitute for a real quote when debugging a customer-visible pricing discrepancy.

---

### 2026-07-02 — Electronic translation client delivery is DOCX+HTML only; auto-generated translator/executor block removed for all service levels

**Decision:**  
Electronic (service_level=electronic) client-facing translation output is DOCX and HTML only — PDF is never generated or delivered for electronic orders. Enforced at the rendering boundary: worker/src/processor.ts branch 4b and src/lib/jobs/processor.ts both route every outputFormat value (including legacy/stale |pdf-suffixed document_type rows) to DOCX or HTML, never Puppeteer/pdf-lib PDF generation. The dashboard upload-form output-format selector no longer offers a PDF option. Official (official_with_translator_signature_and_provider_stamp) and notarization (notarization_through_partners) workflows are unchanged: AI draft DOCX -> human translator/operator review -> final PDF/notary package produced by the human process, not the algorithm; the existing preview-PDF-for-review artifact and its download gating (workflow_status must reach ready_for_delivery/delivered for official; notarized orders are never electronically downloadable) were verified unchanged. Separately, the auto-generated translator/executor certification block (heading + blank Translator/Qualification/Signature/Provider/IIN/Stamp/Date rows) is now removed from ALL algorithm-generated output for every service level, including official and notarization drafts, which previously included it: worker/src/lib/docx-renderer.ts's BLOCK_MODES is now empty and worker/src/lib/renderer.ts + src/lib/pdf/renderer.ts's showCert is hardcoded false. The underlying i18n dictionary (TRANSLATOR_BLOCK_I18N) and render functions are kept intact, just never auto-invoked. The visual/non-text elements block is a separate, unrelated feature and was not touched. A localized electronicOutput.formats.{title,body} disclaimer was added to messages/{locale}/order.json for all 14 locales and is shown in the dashboard upload form, pre-payment quote summary, and post-completion download section.

**Rationale:**  
Product decision: electronic (unofficial/informational) translations must not visually resemble certified/official output, and PDF as an immediately-downloadable, non-editable electronic format implied a level of finality the AI-only electronic tier should not claim. The translator/executor block with blank signature/stamp/IIN fields is exactly the kind of visual signal that could be mistaken for a real certification, even on an AI draft awaiting human review — removing it from the algorithm's output and leaving it to be filled in by the actual human translator/operator during finalization better matches the product's 'UNOFFICIAL TRANSLATION' positioning (PROJECT_CONTEXT.md) and avoids implying automatic notarization/certification.

**Impacted files/docs:**  
worker/src/processor.ts, worker/src/lib/docx-renderer.ts, worker/src/lib/renderer.ts, src/lib/jobs/processor.ts, src/lib/pdf/renderer.ts, src/app/[locale]/dashboard/page.tsx, messages/*/order.json (14 locales), docs/ai-context/40_TRANSLATION_PIPELINE.md, worker/src/lib/__tests__/docx-translator-block.test.ts, worker/src/lib/__tests__/docx-layout.test.ts, worker/src/lib/__tests__/docx-visual-block.test.ts, worker/src/lib/__tests__/renderer-electronic-output-policy.test.ts (new), src/lib/jobs/__tests__/processor.test.ts, src/lib/__tests__/electronic-output-i18n.test.ts (new)

**Risks / caveats:**  
This modifies worker/src/lib/docx-renderer.ts and worker/src/lib/renderer.ts, both listed as frozen in docs/OFFICIAL_DOCX_PIPELINE_FREEZE.md ('Translator/provider block') — done under explicit written approval for this specific change only; OCR, translation prompts/parameters, table-classification, and visual-element detection were NOT touched. The Railway worker completion email has no i18n system and remains hardcoded English-only; the electronic-output disclaimer was not added there — a pre-existing gap, not introduced by this change. renderToPdfBuffer() (src/lib/pdf/renderer.ts) and generatePdfFromHtml()/Puppeteer remain fully functional but are now only reachable via the official/notarized preview-PDF path — if a future change reconnects them to the electronic path, the policy would silently regress without a code-level guard (only tests catch this).

---

### 2026-07-03 — Internal AI Test Lab: add batch mode for launch QA

**Decision:**  
tools/internal-ai-test-lab/run-ai-translation-test.ts now supports three modes (auto-detected from flags): single-file (unchanged), batch (--input-dir + --manifest, processes a reviewed batch-manifest.json sequentially or with --concurrency<=2), and --generate-manifest-template (drafts a manifest from filenames for human review, never used for actual execution). The single-document pipeline was extracted into lib/process-document.ts so both modes share one implementation. Electronic-mode output now also writes a standalone translated-document.INTERNAL_TEST.html file (previously only DOCX+diagnostic-PDF); the diagnostic PDF was renamed translated-document.INTERNAL_DIAGNOSTIC_ONLY.pdf to make its non-deliverable status unambiguous.

**Rationale:**  
Launch QA needs to cover many language pairs/document types before go-live; running the single-file CLI by hand per document does not scale. Batch execution intentionally never guesses source/target language or document type from filenames -- only a human-reviewed manifest drives execution, to avoid silently mis-pricing or mis-translating a QA document. Concurrency is capped at 2 to bound real-time OCR/LLM API cost and rate-limit risk.

**Impacted files/docs:**  
tools/internal-ai-test-lab/README.md, docs/ai-context/20_COMMANDS_AND_TESTS.md

**Risks / caveats:**  
Batch mode spends real OCR/LLM API credits per manifest entry -- a large manifest run against production is a real cost event. A bad manifest entry (wrong service level, wrong document type) still passes alias-map validation if the value is a valid-but-wrong canonical alias -- validation catches malformed/unknown values, not semantically wrong ones.

---

### 2026-07-03 — 50% margin floor (commercial floor) added to pricing calculator

**Decision:**  
calculatePrice() now enforces a hard 50% estimated-margin floor on every standard quote (electronic/official/notarized). If raw price margin (after ALL internal costs/reserves — translator, notary, courier, printing, AI/IT, tax, acquiring, risk, owner, marketing/partner commission) is below 50%, a margin_floor_adjustment line item (isClientVisible=false, isCost=false) raises the final price. Formula: minimum_price = fixed_internal_costs / (1 - percentage_reserve_rate - target_margin_rate), where fixed_internal_costs = translator+notary+courier+printing+AI/IT, and percentage_reserve_rate = tax+acquiring+risk+owner+marketing/partner (each a % of whatever the client is actually charged). Percentage reserves (tax_reserve, acquiring_fee_estimate, risk_chargeback_reserve, owner_reserve, marketing_cac_reserve, partner_commission_cost) are now computed against the FINAL rounded price (post-floor), not the pre-floor subtotal, so stored internal_cost_json always reflects real liability on the amount actually charged. target_profit remains a benchmark only and is never treated as a cost or as a client price component. Config lives in MARGIN_FLOOR_CONFIG (src/lib/pricing/config.ts): targetMarginRate=0.50 per service level, enableMarginFloor=true, rounding 100 KZT (electronic/official) / 500 KZT (notarized). If configured rates make the floor unsolvable (percentage_reserve_rate + target_margin_rate >= 100%), calculatePrice() throws rather than emit a quote that silently misses the floor. Checkout is never blocked by this — it is a fully automatic price adjustment, never an operator confirmation step.

**Rationale:**  
Business requirement: every standard WPO order must clear 50% estimated margin after all real internal costs, not just the WPO service layer — notary/courier/printing are real costs inside the order, not excluded pass-throughs. Under current unit-economics rates (25% target profit rate, ~27.5% combined percentage reserves), this floor binds for nearly all standard orders today — confirmed via a before/after price-delta comparison (electronic/official orders +38-82%, notarized orders +139-142%) reviewed and approved before implementation. Staging only; production promotion requires separate explicit approval per CLAUDE.md.

**Impacted files/docs:**  
`Not specified`

**Risks / caveats:**  
`Not specified`

---

### 2026-07-04 — Layered pricing model: 50% floor scoped to WPO service layer only (supersedes 2026-07-03 whole-order floor)

**Decision:**  
Corrects the 2026-07-03 margin floor decision, which wrongly applied the 50% floor to the WHOLE order including notary/courier/printing pass-through costs, causing notarized prices to explode (e.g. 16,500 -> 39,500 KZT for a simple pickup passport). The floor now applies ONLY to the WPO translation/service layer (minimum_check, extra_words_fee, extra_pages_fee, layout_fee, document_type_coefficient, readability_surcharge, human_review_fee, translator_signature_fee, provider_stamp_fee, translator_reserved_cost, AI/IT reserve, owner_reserve, marketing_cac_reserve). Notary/delivery add-ons (notary_official_fee, printing_binding_fee, delivery_fee, notary urgency surcharge, extra paper copies) are added AFTER the WPO layer's floor step and are NEVER grossed up by it. notary_coordination_fee is a fixed 5,000 KZT WPO commercial fee (NOTARY_CONFIG.notaryCoordinationFeeDefault) — it is WPO REVENUE, not a pass-through: its internal cost is config-driven (NOTARY_CONFIG.notaryCoordinationInternalCostKzt, currently 0 / not configured) and the difference (notaryCoordinationMarginKzt) is real margin that improves the blended order margin, unlike notary_official_fee/printing/delivery which net to zero margin contribution (revenue == cost). Payment-wide fees (tax, Halyk acquiring, risk reserve, referral partner commission) apply once to the WHOLE final client price (WPO layer + notary/delivery add-ons) and are recomputed against the true final rounded price, never the pre-floor subtotal. Blended (whole-order) margin is NOT guaranteed >= 50% for notarized orders — that dilution from real pass-through costs is expected and correct. Separately, the notary MRP fallback (NOTARY_CONFIG.mrpValueFallbackKzt, used only when pricing_versions.mrp_value is null) was updated from an implicit 3.69 (-> 3,690 KZT) to 4,325 KZT, reflecting the current 2026 MRP tariff; version.mrpValue itself (DB-driven, pricing_versions.mrp_value) keeps its pre-existing 'stored in thousands of KZT' convention unchanged — this decision does not reinterpret that column, and the live active pricing_versions row was NOT updated (that is a data change for ops/finance to make separately, not a schema migration).

**Rationale:**  
The 2026-07-03 whole-order floor was reviewed via a before/after price-delta comparison and found to make notary_official_fee (a real, regulated, non-negotiable state tariff) get grossed up as if it were WPO-marginable revenue — mathematically correct given that decision's formula, but not the intended business model. Business clarified: WPO only wants a 50% margin guarantee on the portion of the order it actually controls (translation/service work), while notary/courier/printing pass through at cost (plus the separate, already-margin-bearing 5,000 KZT coordination fee) and payment-wide processing fees apply once at the end. Confirmed via updated price-delta comparison: notarized pickup 16,500 -> 21,000 KZT (was wrongly 39,500 under the whole-order floor), notarized delivery 23,600 -> 29,000 KZT (was wrongly 57,000); electronic/official unaffected by notary-specific changes. Staging only; production promotion requires separate explicit approval per CLAUDE.md.

**Impacted files/docs:**  
`Not specified`

**Risks / caveats:**  
`Not specified`

---

### 2026-07-04 — Notary MRP config fix + WPO margin floor pooling + notarized base minimum derived from official (final approved model)

**Decision:**  
Three related corrections to the 2026-07-04 layered pricing model, bringing notarized pricing to the approved commercial baseline (pickup ~15,000 KZT, delivery ~21,000 KZT, down from the interim 21,000/29,000). (1) MRP config: NOTARY_CONFIG.mrpValueFallbackKzt updated to 4325 (raw KZT); test fixtures use version.mrpValue=4.325 (thousands convention) producing notary_official_fee = round(4325 x 0.53) = 2292 for individual/B2C (was 1956 under the stale 3.69/3690 KZT fallback). (2) WPO margin floor now checks a MARGINABLE REVENUE POOL, not the translation layer alone: pool = translation/service layer price + notary_coordination_fee (both WPO-controlled revenue; notary_official_fee/printing/delivery remain excluded, pure pass-through). Formula: minimumPriceForMargin = (wpoServiceLayerFixedCosts + notaryCoordinationInternalCostKzt) / (1 - percentageReserveRate - targetMarginRate) - notaryCoordinationFee — the fixed 5,000 KZT coordination fee revenue reduces how much the translation layer itself must rise, since it's never itself adjusted. Owner/marketing reserves now scale against the combined pool. New MarginBreakdown field wpoMarginableRevenueKzt = wpoServiceLayerFinalPrice + notaryCoordinationRevenueKzt. For non-notarized orders (coordination fee = 0) this is identical to the prior behavior — electronic/official pricing is unchanged. (3) BASE_MINIMUM_KZT[group].notarization_through_partners is no longer an independently hardcoded, higher figure — it is now DERIVED (via BASE_MINIMUM_KZT_SOURCE, which only defines electronic/official rates) to always equal BASE_MINIMUM_KZT[group].official_with_translator_signature_and_provider_stamp for that same language group. Rationale: notarization is not a separate translation base tier; the translation/service portion of a notarized order is priced identically to official, with notary official fee, WPO coordination fee, printing/binding, and delivery layered on top as separate add-ons.

**Rationale:**  
The 2026-07-04 layered-model correction (previous decision) fixed the whole-order floor bug but introduced two remaining gaps: (a) it excluded notary_coordination_fee from the pool the 50% floor checks, forcing the translation layer alone to hit 50% and inflating notarized pickup to 21,000 KZT when the coordination fee's own margin should have counted; (b) it left the notarized base minimum at its old, independently-set value (e.g. 11,000 KZT for ru_kz vs official's 5,500), which was a leftover from the pre-layered-model era when the notarized base was meant to be an all-in bundle price — now double-charging once notary/coordination/printing are separately layered on top. Verified via updated price-delta comparison: notarized pickup 21,000 -> 15,000 KZT, notarized delivery 29,000 -> 21,000 KZT; electronic/official rows unchanged (1,500 / 6,200 / 22,200 KZT). Business explicitly confirmed target ~15,000 KZT for a standard RU-KZ notarized pickup passport before this change. Staging only; production promotion requires separate explicit approval per CLAUDE.md. Separately, NOTARY_CONFIG.mrpValueFallbackKzt (4,325) only affects quotes when pricing_versions.mrp_value is null — the live active pricing_versions row was NOT updated (data change, not code, out of scope here). Verification SQL (uses the REAL schema — supabase/migrations/0019_pricing_versions.sql — columns are code/status, NOT version/is_active as sometimes assumed): SELECT id, code, status, mrp_value, valid_from, valid_to FROM pricing_versions ORDER BY valid_from DESC; staging-only fix if stale: UPDATE pricing_versions SET mrp_value = 4.325 WHERE status = 'active' AND mrp_value <> 4.325; (mrp_value is stored in thousands of KZT, so 4.325 means 4,325 KZT). See scripts/staging/verify-notary-mrp-value.ts for a guarded, read-only-by-default script wrapping this same check.

**Impacted files/docs:**  
`Not specified`

**Risks / caveats:**  
`Not specified`

---

### 2026-07-09 — Webkassa Z-report: skip zreport/create when no qualifying operations since last successful Z-report

**Decision:**  
Before calling zreport/create, the worker (worker/src/lib/fiscal-z-report.ts) now checks for at least one issued fiscal_receipts row (operation_type sale/refund, provider=webkassa, provider_environment=FISCAL_PROVIDER_ENV) with issued_at after the last successful Z-report for the cashbox (or in the last 24h if no prior successful Z-report exists). If none exist, zreport/create is not called; fiscal_z_reports.status is set to skipped_no_operations (new value added to the CHECK constraint by migration 0045) instead of leaving a noisy failed/pending row. On a DB error while counting, the worker errs toward sending rather than skipping. Code 12/13 handling (already_closed) is unchanged and remains idempotent-safe as a fallback.

**Rationale:**  
Webkassa integrator reported cashbox SWK00529346 received Code 12 ('Смена уже закрыта') on zreport/create for 15+ consecutive days because the worker sent Z-report on a fixed daily schedule regardless of whether any fiscal operation (sale/purchase/return/cash in/cash out) had opened a shift. Per integrator recommendation, the shift only exists to close if a qualifying operation occurred since the last close.

**Impacted files/docs:**  
`Not specified`

**Risks / caveats:**  
Relies on fiscal_receipts.issued_at being set accurately by fiscal-processor.ts (it is, on successful issuance). Does not filter by a per-cashbox column on fiscal_receipts (matches existing single-cashbox assumption elsewhere in the file). forceRunZReport() (manual operator trigger) intentionally bypasses this guard.

---

### 2026-07-11 — Partner Application ID written to main order Jira issue (customfield_10121)

**Decision:**  
worker/src/lib/integrations.ts initializeOrderIntegrations() now looks up the referring partner's Application ID (partner_referrals.job_id -> partner_id -> partners.application_id) and, when present, writes it to customfield_10121 on the main order issue at issue-create time only. Best-effort, non-throwing, omitted entirely (no placeholder) when there is no referral or the lookup misses. No admin UI, no new commission/payout tables — Jira remains the sole partner back-office surface.

**Rationale:**  
Requested minimal partner reporting via the existing Jira integration instead of building a payout/admin interface on the site. Reuses the existing partners/partner_referrals tables and the existing Partnership-issue Application ID that Jira Automation already tracks, so operators can filter/report on referred orders directly in Jira.

**Impacted files/docs:**  
`worker/src/lib/integrations.ts`, `worker/src/lib/jira/order-fields.ts`, `worker/src/lib/jira/__tests__/order-fields.test.ts`, `worker/src/lib/__tests__/integrations-partner-application-id.test.ts`, `docs/ai-context/60_INTEGRATIONS_JIRA_DRIVE_TELEGRAM.md`

**Risks / caveats:**  
Referral attribution is a point-in-time lookup at issue-create time only — if `attachReferralToOrder` (in `src/lib/referral/server.ts`, fire-and-forget on the web side) hasn't written the `partner_referrals` row yet when the worker creates the Jira issue, the field is silently omitted and never backfilled. Relies on `partners.application_id` being populated (set when a partner application is approved); referrals from partners created without a linked application leave the field empty.
