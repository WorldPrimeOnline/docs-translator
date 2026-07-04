# Unit Economics

## Target margins (2026-Q3-KZ-MVP)

| Cost bucket | Rate | Notes |
|---|---|---|
| Tax (VAT) reserve | 3.0% | KZ tax law |
| Acquiring (Halyk) | 2.5% | Card processing fee |
| Risk reserve | 5.0% | Disputes, bad debt, chargebacks |
| Owner reserve | 7.0% | Capital allocation, owner return |
| Marketing (direct) | 10.0% | CAC and retention budget |
| Partner commission | 10.0% | Referral / reseller channel only |
| AI/IT reserve | 100 KZT/page | Claude API, Mistral API, Vercel, Railway |
| Translator reserve | ~30% of translation portion | Translator payout allocation |

**Target net margin (direct channel)**: 25% (`target_profit_rate = 0.25`) — this is a benchmark only, never a cost input.

**Margin floor (commercial floor)**: the **WPO marginable revenue pool** — translation/service
layer price + `notary_coordination_fee` — must clear `wpoServiceMarginRate >= 0.50` after the
pool's own costs (translator, AI/IT, notary coordination internal cost, owner reserve,
marketing/CAC). If the pool's margin falls short, `calculatePrice()`
(`src/lib/pricing/calculator.ts`) automatically raises the **translation layer's own price** (the
coordination fee itself is fixed and never adjusted) via a `margin_floor_adjustment` line item —
never blocks checkout, never shown to the client. `notary_official_fee`, printing, and courier
are separate pass-through add-ons and are **never** grossed up by this floor. Payment-wide fees
(tax, Halyk acquiring, risk, partner commission) apply once, at the end, to the whole final
client price. See `docs/finance/PRICING_ENGINE.md` §§9–11 and `docs/ai-context/DECISIONS.md`
(2026-07-04 entries, which supersede both the original whole-order-floor decision and the first
layered-model correction that excluded `notary_coordination_fee` from the floor's revenue pool).

**Notarized translation is not a separate inflated translation tier.** A notarized order is:
official translation/service layer + notary official fee + WPO notary coordination fee +
printing/binding + delivery (if selected) + payment-wide fees/reserves.
`BASE_MINIMUM_KZT[group].notarization_through_partners` is derived from
`BASE_MINIMUM_KZT[group].official_with_translator_signature_and_provider_stamp` for the same
language group (see `src/lib/pricing/config.ts`) — it is never a separately hardcoded, higher figure.

Current commercial baseline (`mockVersion` pricing-engine fixture — see
`src/lib/pricing/__tests__/calculator.test.ts`):

| Scenario | Final client price | WPO marginable margin % | Blended order margin % |
|---|---|---|---|
| Electronic, RU→KZ, passport, 200 words | 1 500 KZT | 52.2% | 48.1% |
| Official, RU→KZ, passport, 200 words | 6 200 KZT | 51.2% | 46.2% |
| Official, RU→EN, employment_document, 600 words / 2 pages | 22 200 KZT | 52.1% | 46.7% |
| Notarized pickup, RU→KZ, passport | 15 000 KZT | 66.3% | 47.3% |
| Notarized delivery, RU→EN, employment_document, Almaty | 21 000 KZT | 63.5% | 40.8% |

> **These are pricing-engine fixture outputs, not a public guaranteed price list.** The final
> customer price still depends on language pair, word count, page count, document type,
> formatting complexity, urgency, delivery zone, and sales channel (direct/referral/partner).

Electronic/official rows are unaffected by any notary-layer change — confirms the notary add-on
layer and the WPO marginable-pool floor are truly independent of language-pair/document rates.
Notarized WPO marginable margin now runs comfortably above 50% (66.3% / 63.5%) because
`notary_coordination_fee`'s fixed 5,000 KZT revenue (zero internal cost) is folded into the pool
the floor protects — the translation layer itself rarely needs any adjustment for standard-size
notarized documents. Blended order margin is lower and more variable (40–47%) because
`notary_official_fee`/printing/courier are real pass-through costs with zero margin contribution,
diluting the blended rate — expected and correct, not a bug.

## Example: notarized pickup, RU→KZ passport, 1 page, 200 words

Base minimum only (200 words < 250 included, no extra words/pages). The translation/service
layer prices exactly like an official order for the same language group — **not** a separate,
higher notarized tier:

| Translation/service layer | KZT | Visible |
|---|---|---|
| Base minimum (ru_kz, **official tier**, used for notarized too) | 5 500 | Yes |
| **Translation layer raw price** (rounded to 100) | **5 500** | Yes |

Fixed costs: AI/IT reserve 100, translator reserve (30% of 5 500) 1 650, notary coordination
internal cost 0 (config) → **wpoServiceLayerFixedCosts = 1 750**.
Pool percentage rate (direct channel) = owner 7% + marketing 10% = **17%**.

WPO marginable revenue pool = translation layer (5 500) + `notary_coordination_fee` (5 000,
fixed, WPO revenue) = **10 500**. Estimated pool margin at this raw combination:
`10500 - 1750 - 10500×0.17 = 6965`, i.e. **66.3%** — already above the 50% floor, so **no
`margin_floor_adjustment` is needed** (the fixed coordination-fee revenue alone comfortably
clears the target; the earlier, corrected model excluded it from the pool and wrongly forced the
translation layer up to 11,000 KZT to hit 50% on its own).

Notary/delivery pass-through add-ons are added next (never touched by the floor above):

| Add-on | KZT | Visible | Internal cost |
|---|---|---|---|
| `notary_official_fee` (4 325 MRP × 0.53 = 2 292.25) | 2 292 | Yes | 2 292 (pass-through) |
| `notary_coordination_fee` (fixed WPO fee) | 5 000 | Yes | 0 — real margin, already counted in the pool above |
| `printing_binding_fee` | 500 | Yes | 500 (pass-through) |
| `delivery_fee` | 0 (pickup) | Yes (zero row) | 0 |
| **finalBeforePaymentWideFees** | **13 292** | — | — |

Payment-wide fees (tax 3% + acquiring 2.5% + risk 5% = 10.5%, direct channel, no partner
commission) gross this up and round to the notarized 500 KZT increment:

```
finalClientPrice = roundUp(13292 / (1 - 0.105), 500) = roundUp(14850.3, 500) = 15 000
```

| Final summary | KZT |
|---|---|
| **Final client price** | **15 000** |
| WPO marginable revenue (translation layer + coordination fee) | 10 500 |
| WPO marginable margin | 6 965 (66.3%) |
| Payment-wide fees (tax+acquiring+risk on 15 000) | 1 575 |
| Blended order margin | ~7 100 (47.3%) |

See `docs/finance/PRICING_ENGINE.md` §§7–11 for the full mechanics.

## Language group pricing basis

Base minimums are set to ensure that after internal reserves, the translator is compensated at market rate and the business achieves target margin.

**Notary MRP tariff**: `notary_official_fee = notary_mrp_value_kzt × notary_mrp_coefficient`.
`notary_mrp_value_kzt` comes from `version.mrpValue × 1000` (DB-driven, `pricing_versions.mrp_value`,
stored "in thousands of KZT" — e.g. `4.325` means 4 325 KZT), falling back to
`NOTARY_CONFIG.mrpValueFallbackKzt` (currently **4 325 KZT**, reflecting the current 2026 MRP
tariff) only when `pricing_versions.mrp_value` is null. `notary_mrp_coefficient` is **0.53** for
`individual` (B2C default), **1.10** for `legal_entity`.

**Known caveat**: the code fallback (4 325) does not by itself guarantee live quotes use the
current MRP — if the active `pricing_versions` row's `mrp_value` column is stale (e.g. still the
old `3.69`), real quotes will keep using that old figure until it's updated. See
`docs/ai-context/DECISIONS.md` (2026-07-04) for the verification/update SQL and why this needs a
manual data check, not a schema migration.

## Version management

When rates change (e.g. Halyk acquiring rate changes), create a new row in `pricing_versions` with a new `code` and updated `valid_from`. Set the previous version's `valid_to` and status to `'historical'`. Set the new version's status to `'active'`. All new quotes will use the active version. Existing paid quotes are frozen at the version they were computed under.
