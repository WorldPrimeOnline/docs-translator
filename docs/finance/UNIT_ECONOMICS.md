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

**Margin floor (commercial floor, added 2026-07-03)**: every standard quote must clear `estimated_margin_rate >= 0.50` after ALL internal costs/reserves (translator, notary, courier, printing, AI/IT, tax, acquiring, risk, owner, marketing/partner commission). If the raw price falls short, `calculatePrice()` (`src/lib/pricing/calculator.ts`) automatically raises the final price via a `margin_floor_adjustment` line item — never blocks checkout, never shown to the client. See `docs/finance/PRICING_ENGINE.md` §11 and `docs/ai-context/DECISIONS.md`.

Because the 50% floor is well above the 25% target-profit benchmark and above this fixture's combined ~27.5% reserve rate, **the floor now binds for most standard orders** — this is a deliberate, approved business decision, not a bug. A before/after comparison at feature approval time (same rates as below) showed:

| Scenario | Before floor | After floor | Delta |
|---|---|---|---|
| Electronic, RU→KZ, passport, 200 words | 1 000 KZT | 1 800 KZT | +80% |
| Official, RU→KZ, passport, 200 words | 5 500 KZT | 7 800 KZT | +42% |
| Notarized pickup, RU→KZ, passport | 16 500 KZT | 39 500 KZT | +139% |
| Notarized delivery, RU→EN, employment_document | 23 600 KZT | 57 000 KZT | +142% |

Notarized orders see the largest increase because notary/coordination/printing are large *fixed* costs that must be grossed up by the full floor factor, only partially offset by their matching revenue items.

## Example: RU→EN official passport, 1 page, 300 words (50 extra)

Base minimum + extra words only (no document coefficient — passport is 1.00×):

| Item | KZT | Visible |
|---|---|---|
| Base minimum (ru_en_uz, official) | 6 500 | Yes |
| Extra words (50 × 22) | 1 100 | Yes |
| **Raw price before margin floor** (rounded to 100) | **7 600** | Yes |

Fixed costs at this raw price: AI/IT reserve 100, translator reserve (30% of 7 600) 2 280 → **fixedInternalCosts = 2 380**. Percentage reserve rate (direct channel) = 3% + 2.5% + 5% + 7% + 10% = **27.5%**.

Estimated margin at the raw price: `7600 - 2380 - 7600×0.275 = 3110`, i.e. **40.9%** — below the 50% floor, so the floor triggers:

```
minimumPriceForMargin = 2380 / (1 - 0.275 - 0.50) = 2380 / 0.225 = 10 578
finalAmount = roundUp(10 578, 100) = 10 600
margin_floor_adjustment = 10 600 - 7 600 = 3 000
```

| Item (after floor) | KZT | Visible |
|---|---|---|
| margin_floor_adjustment | 3 000 | No (operator audit only) |
| **Final client price** | **10 600** | Yes (as one number) |
| AI/IT reserve | 100 | No |
| Translator reserve (30% of 7 600) | 2 280 | No |
| Tax 3% *(of final price 10 600)* | 318 | No |
| Acquiring 2.5% *(of final price)* | 265 | No |
| Risk 5% *(of final price)* | 530 | No |
| Owner 7% *(of final price)* | 742 | No |
| Marketing 10% *(of final price)* | 1 060 | No |
| Total internal costs | 5 295 | — |
| **Estimated margin** | **5 305 KZT (50.0%)** | — |
| Target profit (25% benchmark, informational) | 1 900 | No |

Percentage reserves are computed against the **final** 10 600 KZT price, not the pre-floor 7 600 — see `docs/finance/PRICING_ENGINE.md` §11.

## Language group pricing basis

Base minimums are set to ensure that after internal reserves, the translator is compensated at market rate (≥ `MRP × 3.69` per standard page) and the business achieves target margin.

Current MRP value (2026): 3.69 KZT.

## Version management

When rates change (e.g. Halyk acquiring rate changes), create a new row in `pricing_versions` with a new `code` and updated `valid_from`. Set the previous version's `valid_to` and status to `'historical'`. Set the new version's status to `'active'`. All new quotes will use the active version. Existing paid quotes are frozen at the version they were computed under.
