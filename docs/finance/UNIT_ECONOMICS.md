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

**Target net margin (direct channel)**: 25% (`target_profit_rate = 0.25`)

## Example: RU→EN official, 1 page, 300 words (50 extra)

| Item | KZT | Visible |
|---|---|---|
| Base minimum (ru_en_uz, official) | 6 500 | Yes |
| Extra words (50 × 25) | 1 250 | Yes |
| Subtotal before reserves | 7 750 | — |
| AI/IT reserve (1 page × 100) | 100 | No |
| Tax 3% | 233 | No |
| Acquiring 2.5% | 194 | No |
| Risk 5% | 388 | No |
| Owner 7% | 543 | No |
| Marketing 10% | 775 | No |
| Translator reserve 30% of 7 750 | 2 325 | No |
| **Gross total** | ~12 308 | — |
| **Final (rounded to 100)** | **12 400** | Yes |

## Language group pricing basis

Base minimums are set to ensure that after internal reserves, the translator is compensated at market rate (≥ `MRP × 3.69` per standard page) and the business achieves target margin.

Current MRP value (2026): 3.69 KZT.

## Version management

When rates change (e.g. Halyk acquiring rate changes), create a new row in `pricing_versions` with a new `code` and updated `valid_from`. Set the previous version's `valid_to` and status to `'historical'`. Set the new version's status to `'active'`. All new quotes will use the active version. Existing paid quotes are frozen at the version they were computed under.
