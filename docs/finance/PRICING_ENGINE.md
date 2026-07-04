# Pricing Engine

## Algorithm (in order)

All pricing is in KZT. Final price is always rounded up to the nearest 100 KZT.

### 1. Resolve language group

17 groups defined in `src/lib/pricing/config.ts`. If the pair is not one of the 16 named groups, it is priced via the `'other'` bucket (full rate data, real price — not zero) and does **not** require operator review, as long as both language codes are recognized. Only a genuinely unrecognized code (`'auto'`, empty, a typo) forces `requiresOperatorReview = true`, since an unrecognized code can't be safely priced at all.

| Group | Example pairs |
|---|---|
| ru_kz | ru↔kk, ru↔kz |
| ru_en_uz | ru↔en, ru↔uz, ru↔tj, ru↔tk, ru↔mn, ru↔ky |
| ru_tr | ru↔tr |
| ru_de_fr | ru↔de, ru↔fr |
| ru_es_it | ru↔es, ru↔it |
| ru_zh_ar | ru↔zh, ru↔ar |
| ru_ko | ru↔ko |
| ru_ja_th | ru↔ja, ru↔th |
| kz_en | kk↔en, kz↔en |
| ... | ... |

### 2. Base minimum (per language group × service level)

Looked up from `BASE_MINIMUM_KZT[group][serviceLevel]`.

**`notarization_through_partners` is NOT a separate, independently-priced tier.** It is derived
from the `official_with_translator_signature_and_provider_stamp` base for the SAME language
group — see `BASE_MINIMUM_KZT_SOURCE` in `src/lib/pricing/config.ts`, which only defines
electronic/official rates; the notarized column is built programmatically
(`notarization_through_partners = official_with_translator_signature_and_provider_stamp`) so the
two can never drift apart. A notarized order's translation/service layer is priced exactly like
an official order — notary official fee, WPO coordination fee, printing/binding, and delivery
are separate add-ons layered on top (§7, §8), not baked into a bigger base minimum. See
`docs/ai-context/DECISIONS.md` (2026-07-04, notarized base minimum fix).

Example (ru_kz group):
- electronic: 1 000 KZT
- official_with_translator_signature_and_provider_stamp: 5 500 KZT
- notarization_through_partners: 5 500 KZT (== official, derived)

Included words per order: 250 words. First 250 words are covered by the minimum.

### 3. Extra words (beyond 250)

`extraWords = max(0, sourceWordCount - 250)`  
`extraWordsCost = extraWords × EXTRA_WORD_RATE_KZT[group]` (e.g. 20–35 KZT/word)

### 4. Additional pages (beyond 1)

`additionalPages = max(0, physicalPageCount - 1)`  
`additionalPagesCost = additionalPages × ADDITIONAL_PAGE_RATE_KZT[serviceLevel]`  
(e.g. official: 1 500 KZT/page, notarized: 2 000 KZT/page)

### 5. Document type coefficient

Applied to the **translation portion** only (base minimum + extra words + extra pages).

| Document type | Coefficient |
|---|---|
| passport_id, employment_document, other | 1.00 |
| diploma_transcript, police_clearance | 1.25 |
| medical_document, bank_statement | 1.50 |
| contract, visa_documents | 1.30 |
| driver_license | 1.10 |
| presentation | 0.80 |

`translationPortion = translationSubtotal × documentCoefficient`

### 6. Urgency coefficient

Applied to the translation portion after document coefficient.

| Urgency | Coefficient |
|---|---|
| standard | 1.00 |
| within_24h | 1.50 |
| six_to_twelve_hours | 2.00 |
| two_to_four_hours | 3.00 |

`urgencyFee = translationPortion × (urgencyCoefficient - 1.0)`

### 7. Notary components (notarization_through_partners only) — separate add-on layer

These are added to the client price **after** the WPO service layer's own margin floor (§11) —
never subject to document/urgency coefficients, and never grossed up by the WPO 50% floor:

| Item | Amount | Nature |
|---|---|---|
| `notary_official_fee` | `notary_mrp_value_kzt × notary_mrp_coefficient` (rounded) | Pass-through — paid to the notary, zero margin contribution |
| `notary_coordination_fee` | Fixed **5 000 KZT** (`NOTARY_CONFIG.notaryCoordinationFeeDefault`) | **WPO commercial revenue, NOT pass-through** — see below |
| `printing_binding_fee` | Fixed 500 KZT (`NOTARY_CONFIG.printingBindingFee`) | Pass-through — zero margin contribution |

**`notary_official_fee` (MRP-based, deterministic)**:
- `notary_mrp_value_kzt` = `version.mrpValue × 1000` (DB-driven, stored "in thousands of KZT")
  if `pricing_versions.mrp_value` is set, else falls back to `NOTARY_CONFIG.mrpValueFallbackKzt`
  (currently **4 325 KZT**, reflecting the current 2026 MRP tariff).
- `notary_mrp_coefficient`: `NOTARY_APPLICANT_MRP_COEFFICIENT[applicantType]` — **0.53** for
  `individual` (B2C default), **1.10** for `legal_entity`; `unknown` triggers operator review.
- Example: 4 325 × 0.53 = 2 292.25 → rounds to **2 292 KZT**.
- Both `notary_mrp_value_kzt` and `notary_mrp_coefficient` are recorded on the
  `notary_official_fee` line item's `metadataJson` for audit — never hardcoded, never merged
  with `notary_coordination_fee`.

**`notary_coordination_fee` — WPO revenue, not a cost**: this is WPO's own fixed commercial fee
for handling/coordinating the notary process — a business decision, not derived from MRP.
Unlike the other two notary items, its client-charged amount (5 000 KZT) is **not** treated as
100% internal cost. The real internal cost is `NOTARY_CONFIG.notaryCoordinationInternalCostKzt`
(currently **0** — not configured; change this only when a real cost is confirmed). The
difference (`notaryCoordinationMarginKzt = notaryCoordinationRevenueKzt - notaryCoordinationInternalCostKzt`,
today = 5 000 KZT) is real WPO margin that flows into the blended order margin (§11) — it is
never netted to zero the way `notary_official_fee`/`printing_binding_fee`/`delivery_fee` are.

Notarized orders auto-quote like any other service level — the MRP-based notary official fee is a deterministic formula, so it does not require operator review before checkout. Operator confirmation of the actual notary slot/translator availability happens **after** payment, not before; it never gates whether a price is shown. See `docs/ai-context/DECISIONS.md` (2026-07-01).

### 8. Delivery fee — separate add-on, same layer as notary components

Added only when `deliveryRequired = true` or `fulfillmentMethod = 'delivery'`.
Amount from `DELIVERY_ZONE_FEE_KZT[deliveryZone]` — `almaty_standard` = 2 500 KZT (other zones →
operator review). Pass-through: zero margin contribution, matching `internalCosts.courierCost`
exactly. Part of the notary/delivery add-on layer (§7) — never grossed up by the WPO service
layer's margin floor (§11), and applies regardless of service level (not notarized-only).

### 9. Internal costs/reserves — three layers, not one pool

The pricing model has THREE layers with different rules (§11 has the full floor mechanics):

1. **WPO marginable revenue pool** — translation/service layer price + `notary_coordination_fee`
   (both WPO-controlled revenue). The ONLY pool the 50% margin floor applies to.
2. **Notary/delivery pass-through add-ons** (§7, §8) — added after the floor, never grossed up:
   `notary_official_fee`, `printing_binding_fee`, `delivery_fee`.
3. **Payment-wide fees** (tax/acquiring/risk/partner commission) — applied once to the whole
   final client price (pool + pass-through add-ons), recomputed against the true final rounded price.

**WPO marginable pool — fixed costs** (independent of the final client price):

| Cost | Amount |
|---|---|
| AI/IT reserve | `version.aiItReservePerPageKzt × pages` |
| Translator reserve | 30% of translation portion |
| Notary coordination internal cost | `NOTARY_CONFIG.notaryCoordinationInternalCostKzt` (currently **0**, config-driven) |

**WPO marginable pool — percentage reserves** (owner reserve + marketing/CAC — these scale with
the POOL's combined revenue — translation layer + `notary_coordination_fee` — not the
translation layer alone, and not the whole order):

| Reserve | Rate |
|---|---|
| Owner reserve | `version.ownerReserveRate` (7%) |
| Marketing (direct) | `version.marketingRateDirect` (10%) |
| Marketing top-up (referral) | flat 2% (referral partner commission itself is payment-wide, not part of the pool) |

**Notary/delivery pass-through add-ons** (§7, §8; NOT part of the marginable pool, NOT grossed
up by its floor — these have zero margin contribution, revenue == cost exactly):

| Item | Internal cost | Notes |
|---|---|---|
| `notary_official_fee` | `internalCosts.notaryFee` — exactly equals the revenue item | Zero margin contribution |
| `printing_binding_fee` | `internalCosts.printingCost` — exactly equals the revenue item | Zero margin contribution |
| `delivery_fee` | `internalCosts.courierCost` — exactly equals the revenue item | Zero margin contribution |

`notary_coordination_fee` is explicitly NOT in this pass-through table — its revenue (5 000 KZT)
and its internal cost (`internalCosts.notaryCoordinationInternalCostKzt`, currently 0) are
**part of the WPO marginable pool above**, not a pass-through add-on; the difference between
them is real WPO margin.

**Payment-wide fees** (applied once, to the WHOLE final client price — marginable pool + pass-through add-ons):

| Reserve | Rate |
|---|---|
| Tax (VAT) | `version.taxRate` (3%) |
| Acquiring | `version.acquiringRate` (2.5%) |
| Risk reserve | `version.riskReserveRate` (5%) |
| Partner commission (referral) | `version.partnerCommissionRate` (10%) |

### 10. WPO service layer rounding (before its own margin floor)

```
wpoServiceLayerRawPrice = Math.ceil(wpoServiceSubtotal / 100) * 100
```

Always rounds up, always the plain 100 KZT increment regardless of service level — this layer
never includes notary/delivery add-ons, so it has no reason to use the notarized 500 KZT
increment (that only applies to the whole order's final rounding in §11).

### 11. Margin floor (commercial floor) — WPO marginable revenue pool ONLY

**Business rule**: the WPO **marginable revenue pool** — translation/service layer price +
`notary_coordination_fee` — must have `wpoServiceMarginRate >= 50%` after the pool's own costs
(translator, AI/IT, notary coordination internal cost, owner reserve, marketing/CAC).
`notary_official_fee`, courier, and printing are **excluded** from this pool — they are real
pass-through costs added afterward, never grossed up by this floor. See
`docs/ai-context/DECISIONS.md` (2026-07-04), which supersedes both the original 2026-07-03
decision (which wrongly applied the floor to the whole order) and the first layered-model
correction (which wrongly excluded `notary_coordination_fee` from the pool the floor checks).

**Why `notary_coordination_fee` is IN the pool**: it is WPO's own commercial revenue, not a
pass-through — excluding it from the floor calculation forced the translation layer alone to
carry the full 50% target, inflating notarized prices unnecessarily (an earlier, corrected bug:
notarized pickup priced at 21,000 KZT instead of the intended ~15,000 KZT). Because the fee is
fixed and never itself adjusted, folding it into the pool means a large `notary_coordination_fee`
naturally reduces how much the translation layer needs to rise to hit the target — often to zero.

If the pool's margin at `wpoServiceLayerRawPrice + notary_coordination_fee` is below target, only
the **translation layer's own price** is solved for (the coordination fee itself never changes):

```
wpoMarginableRevenueBeforeFloor = wpoServiceLayerRawPrice + notary_coordination_fee
minimumPriceForMargin = (wpoServiceLayerFixedCosts + notaryCoordinationInternalCost)
                        / (1 - wpoServiceLayerPercentageReserveRate - targetMarginRate)
                        - notary_coordination_fee
wpoServiceLayerFinalPrice = roundUp(max(wpoServiceLayerRawPrice, minimumPriceForMargin), 100)
```

A `margin_floor_adjustment` line item is added (`isClientVisible: false`, `isCost: false`)
equal to `wpoServiceLayerFinalPrice - wpoServiceLayerRawPrice`, scoped to the translation layer
only. It's part of the final client price (reconciliation includes it) but never shown to the
client. **For most standard orders it is now 0** — the coordination fee alone typically clears
the 50% target (see the worked example in `docs/finance/UNIT_ECONOMICS.md`); the floor still
engages for larger orders (many pages) where the translation layer's own fixed costs grow enough
to outpace the fixed coordination-fee cushion.

`wpoMarginableRevenueKzt = wpoServiceLayerFinalPrice + notary_coordination_fee` is the final pool
value reported in `margin_json` and Jira — owner/marketing reserves are recomputed against it.

**Then, and only then**, notary/delivery pass-through add-ons are added on top (§7, §8):

```
finalBeforePaymentWideFees = wpoServiceLayerFinalPrice + notaryDeliveryAddonsKzt
```

(`notaryDeliveryAddonsKzt` includes `notary_official_fee` + `notary_coordination_fee` +
`printing_binding_fee` + `delivery_fee` — the coordination fee is added to the price stack here
exactly as before; only the FLOOR CALCULATION treats it as pool revenue, not its position in the
final price buildup.)

**Payment-wide fees** (tax/acquiring/risk/partner commission, §9) apply once to this combined
amount, recomputed against the TRUE final rounded price:

```
finalClientPrice = roundUp(finalBeforePaymentWideFees / (1 - paymentWideFeeRate), finalRoundingIncrement)
```

Final rounding increment: 100 KZT (electronic/official) or 500 KZT (notarized) — see
`MARGIN_FLOOR_CONFIG.roundingKzt` in `src/lib/pricing/config.ts`. This is the ONLY place the
500 KZT increment is used; the WPO layer's own floor (§10) always uses 100 KZT. A
`payment_wide_fee_adjustment` line item captures the gross-up + final-rounding residual
(`isClientVisible: false`, `isCost: false`), same pattern as `margin_floor_adjustment`.

If the configured rates make either step unsolvable (`percentageReserveRate + targetMarginRate >= 1`
for the WPO layer, or `paymentWideFeeRate >= 1` for the payment-wide step),
`calculatePrice()` throws rather than silently emit a quote that misses the floor — this
indicates a `pricing_versions` misconfiguration that must be fixed before quoting, not a
checkout-blocking condition for a normal order.

**This never blocks checkout** — it's a fully automatic price adjustment computed before the
quote is shown, not an operator confirmation step.

**Blended (whole-order) margin is reported but NOT floor-protected** — for notarized orders it
is expected and correct for the blended rate to sit well below 50%, since notary/courier/printing
pass-throughs dilute it (partially offset by `notary_coordination_fee`'s real margin). Only
`wpoServiceMarginRate` is guaranteed >= `targetMarginRate` whenever the floor is enabled.

## Customer Pricing Inputs (from upload form)

Only these fields are accepted from the public upload form. The backend schema rejects deprecated system-analysis fields if sent.

| Field | Required | Notes |
|---|---|---|
| `sourceLanguage` | **Yes** | Must not be `'auto'`. Rejected at API level. |
| `targetLanguage` | **Yes** | |
| `serviceLevel` | **Yes** | `electronic` / `official_with_translator_signature_and_provider_stamp` / `notarization_through_partners` |
| `documentType` | Optional | Drives document coefficient |
| `notaryCity` | Notarization | City selector |
| `fulfillmentMethod` | Notarization | `pickup` / `delivery` |
| `deliveryZone` | Delivery only | `almaty_standard` = 2 500 KZT; other zones → operator review |
| `applicantType` | Notarization | `individual` / `legal_entity` / `unknown` → operator review |
| `notaryUrgencyLevel` | Notarization | `standard` / `same_day` (Almaty cutoff rules apply) |
| `customerComment` | Optional | Free text, max 2 000 chars; stored on `jobs.customer_comment`; included in Jira description |

## System-Derived Pricing Signals (not from upload form)

These are determined after document analysis. Clients do not set them. They default to conservative values until AI/OCR analysis or operator override provides actual values.

| Field | Default | Source |
|---|---|---|
| `urgencyLevel` | `standard` | Hardcoded — no translation urgency surcharge in current product |
| `scanQuality` | `normal` | OCR/AI analysis (future: `poor_scan` = +15%, `handwritten` = operator review) |
| `layoutComplexity` | `standard` | OCR/AI analysis (future: `tables`/`complex_tables` = per-page fee, `complex_layout` = +25%) |
| `visualMarksComplexity` | `normal` | Page-vision analysis (future: `many_stamps` = +1 000 KZT to subtotal) |
| `extraPaperCopies` | `0` | Operator-only until notary confirms |
| `sourceWordCount` | From OCR | Determined after OCR completes |
| `physicalPageCount` | `1` (conservative) | Determined after OCR |

### Why scan quality, layout, and stamps are not customer inputs

Clients cannot objectively self-report OCR difficulty. A client describing a poor scan as "normal" would result in systematic underpricing. These signals must come from AI/OCR analysis or operator override, not self-assessment.

### Why extra paper copies is operator-only

The count and cost of notarial copies must be confirmed by the notary partner before the customer is billed. Exposing this to the customer before confirmation creates pricing discrepancies.

### Why urgency surcharge applies only to notary, not translation

For electronic and official translations, WPO currently operates on a standard turnaround. Client-controlled urgency pricing requires staffing guarantees not yet in place. Notary urgency (`notaryUrgencyLevel`) is gated by Almaty time windows because notary offices have hard physical cutoff hours.

### Why `sourceLanguage='auto'` is forbidden

The language pair drives `BASE_MINIMUM_KZT` and rate lookups. If `'auto'` is passed, `resolveLanguageGroup` cannot find a matching group and returns `requiresReview: true`. The upload-card API route rejects `sourceLang=auto` at the schema level.

### Customer comment handling

The optional `customerComment` field (max 2 000 chars) is stored as `jobs.customer_comment` and included in the Jira issue description. It is never used in pricing and never sent to AI models.

## Notary Urgency and Almaty Cutoff Rules

Notary same-day processing uses Asia/Almaty time (UTC+5, no DST). All cutoff calculations
are server-side only — client browser time is never used.

### Windows

| Window | Almaty hours | Multiplier applied to | Quote expires |
|---|---|---|---|
| standard | any | — | 24 hours |
| same_day_before_noon | 00:00–11:59 | coord fee ×1.0 (no surcharge) | Today 12:00 Almaty |
| same_day_after_noon | 12:00–17:59 | coord fee ×1.5 (+50%) | Today 18:00 Almaty |
| same_day_after_18 | 18:00–23:59 | coord fee ×2.0 (×2 night) | Now + 2 hours |

### What IS multiplied by notary urgency
- `notary_coordination_fee` (WPO's fixed commercial coordination fee, default 5 000 KZT — see §7)

### What is NOT multiplied by notary urgency
- `notary_official_fee` (MRP-based state duty — regulated, not adjustable)
- `printing_binding_fee`
- `delivery_fee`
- Translation/layout portion (use `urgencyLevel` for that)

### Cutoff enforcement at payment time
If a same-day quote was created before a window boundary (e.g. before noon) but the
user tries to pay after the boundary has passed, `POST /api/payments/halyk/initiate`
reads `price_quotes.pricing_context_json.notaryCutoff.cutoffAt`, compares to `new Date()`,
and returns `NOTARY_CUTOFF_PASSED` (HTTP 422). The quote is also marked `expired`.
The user must re-upload to get a new quote at the current window's rate.

### Quote expiry
- `standard` → 24 hours (unchanged)
- `same_day_before_noon` → quote expires at 12:00 Almaty today
- `same_day_after_noon` → quote expires at 18:00 Almaty today
- `same_day_after_18` → quote expires 2 hours from creation time

### Why Asia/Almaty
WPO operates notary partner services in Almaty (UTC+5). Notary offices work on Almaty
local time. Cutoff decisions must be consistent regardless of server location or user timezone.

### New pricing input
| Field | Values | Default | Effect |
|---|---|---|---|
| `notaryUrgencyLevel` | `standard` \| `same_day` | `standard` | Triggers cutoff window lookup and time-based quote expiry |

## Presentation / Pitch Deck Pricing

Presentations (`documentType = 'presentation'`) are **not** automatically sent to operator review.

### When WPO calculates automatically

If `physicalPageCount` is known (≥ 1, which it always is given the conservative default of 1):
- Document coefficient **1.60** applies to the full translation portion (base + slide fees)
- Additional slides beyond the 1st: `presentation_slides_fee` line item
  - electronic: 500 KZT/slide
  - official: 1 000 KZT/slide
  - notarized: 1 000 KZT/slide
- `additional_pages` line item is skipped for presentations (slides fee replaces it)

### Quote at upload time

At upload, `physicalPageCount = 1` (conservative default — OCR hasn't run). The initial quote
covers 1 slide. After OCR the quote can be recalculated with the real slide count.

### When operator review is triggered

| Reason | Code |
|---|---|
| `physicalPageCount` explicitly 0 or negative | `presentation_slide_count_unknown` |
| Complex design recreation requested (future) | `presentation_complex_design_manual_review` |
| Embedded official documents detected (future) | `presentation_embedded_official_docs` |
| Notarized presentation (inherits notary review) | covered by notary review reason |

### What the 1.60 coefficient applies to

The 1.60 coefficient is applied to the translation portion (base minimum + extra words + slide fees)
**only**. It does not multiply notary official fees, delivery fees, or fiscal reserves.

## Code location

- `src/lib/pricing/config.ts` — all rate tables (including new: SCAN_QUALITY_SURCHARGE, LAYOUT_COMPLEXITY_CONFIG, VISUAL_MARKS_FEE_KZT, DELIVERY_ZONE_FEE_KZT, NOTARY_APPLICANT_MRP_COEFFICIENT, EXTRA_PAPER_COPY_FEE_KZT, MARGIN_FLOOR_CONFIG, `NOTARY_CONFIG.notaryCoordinationInternalCostKzt`, `NOTARY_CONFIG.mrpValueFallbackKzt`, `BASE_MINIMUM_KZT_SOURCE` — the electronic/official rates `BASE_MINIMUM_KZT.notarization_through_partners` is derived from)
- `src/lib/pricing/calculator.ts` — `calculatePrice(input, version)`
- `src/lib/pricing/service.ts` — DB integration (`getActivePricingVersion`, `computeQuoteForJob`, `saveQuote`, etc.)
