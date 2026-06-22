# Pricing Engine

## Algorithm (in order)

All pricing is in KZT. Final price is always rounded up to the nearest 100 KZT.

### 1. Resolve language group

17 groups defined in `src/lib/pricing/config.ts`. If the pair is not found, the price is set to 0 and `requiresOperatorReview = true`.

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

Example (ru_kz group):
- electronic: 2 500 KZT
- official_with_translator_signature_and_provider_stamp: 5 500 KZT
- notarization_through_partners: 9 000 KZT

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

### 7. Notary components (notarization_through_partners only)

Three fixed cost items added (not subject to document/urgency coefficients):
- Notary official fee: `MRP × version.mrpValue × 20` KZT (state duty estimate)
- Notary coordination fee: fixed 3 000 KZT
- Printing/binding: fixed 1 500 KZT

All notarized orders are flagged `requiresOperatorReview = true`.

### 8. Delivery fee

Added only when `deliveryRequired = true` or `fulfillmentMethod = 'delivery'`.
Delivery fee: 1 000 KZT (currently fixed).

### 9. Internal reserves (not client-visible, isCost = true)

Applied to the raw subtotal (before reserves). Each is a percentage or fixed amount:

| Reserve | Rate | Applied to |
|---|---|---|
| AI/IT reserve | `version.aiItReservePerPageKzt × pages` | fixed per page |
| Tax (VAT) | `version.taxRate` (3%) | subtotal |
| Acquiring | `version.acquiringRate` (2.5%) | subtotal |
| Risk reserve | `version.riskReserveRate` (5%) | subtotal |
| Owner reserve | `version.ownerReserveRate` (7%) | subtotal |
| Marketing (direct) | `version.marketingRateDirect` (10%) | subtotal |
| Partner commission (referral/reseller) | `version.partnerCommissionRate` (10%) | subtotal |
| Translator reserve | 30% of translation portion | translation portion |

For referral/reseller channels: partner commission replaces 90% of marketing reserve.

### 10. Final rounding

```
finalAmount = Math.ceil(grossTotal / 100) * 100
```

Always rounds up. Minimum floor: BASE_MINIMUM_KZT for the group/service level.

## Required Pricing Inputs

All inputs are optional at the TypeScript level but some **must** be set explicitly to get an accurate quote. Omitting them falls back to safe defaults that may under- or over-price the order.

| Field | Required | Default | Effect of omission |
|---|---|---|---|
| `sourceLanguage` | **Yes** | — | Must never be `'auto'` — unknown pair → `requiresOperatorReview = true`. Rejected at API level. |
| `targetLanguage` | **Yes** | — | Same as above. |
| `serviceLevel` | **Yes** | `'electronic'` | Determines base minimum and word/page rates. |
| `urgencyLevel` | Recommended | `'standard'` | `standard` = no surcharge; higher values apply coefficient. |
| `scanQuality` | Recommended | `'normal'` | `poor_scan` = +15%; `handwritten` = operator review. |
| `layoutComplexity` | Recommended | `'standard'` | `tables`/`complex_tables` = fixed fee per page; `complex_layout` = +25% multiplier; `presentation` = operator review. |
| `visualMarksComplexity` | Recommended | `'normal'` | `many_stamps` = +1 000 KZT flat fee to subtotal (not translation portion). |
| `applicantType` | Notarization | `'individual'` | Drives notary MRP coefficient: individual=0.53, legal_entity=1.10, unknown=operator review. |
| `deliveryZone` | Delivery | `almaty_standard` fallback | `almaty_standard`=2 500 KZT; other zones → operator review. |
| `extraPaperCopies` | Optional | `0` | Notarization only: +500 KZT per copy. |

### Why `sourceLanguage='auto'` is forbidden

The language pair drives `BASE_MINIMUM_KZT`, `EXTRA_WORD_RATE_KZT`, and `EXTRA_WORD_RATE_KZT` lookups. If `'auto'` is passed, `resolveLanguageGroup` cannot find a matching group and returns `requiresReview: true`, making the order unquotable. The upload-card API route rejects `sourceLang=auto` at the schema level. The frontend must always show a mandatory source-language selector.

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
- `notary_coordination_fee` (operational coordination cost, default 3 000 KZT)

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

## Code location

- `src/lib/pricing/config.ts` — all rate tables (including new: SCAN_QUALITY_SURCHARGE, LAYOUT_COMPLEXITY_CONFIG, VISUAL_MARKS_FEE_KZT, DELIVERY_ZONE_FEE_KZT, NOTARY_APPLICANT_MRP_COEFFICIENT, EXTRA_PAPER_COPY_FEE_KZT)
- `src/lib/pricing/calculator.ts` — `calculatePrice(input, version)`
- `src/lib/pricing/service.ts` — DB integration (`getActivePricingVersion`, `computeQuoteForJob`, `saveQuote`, etc.)
