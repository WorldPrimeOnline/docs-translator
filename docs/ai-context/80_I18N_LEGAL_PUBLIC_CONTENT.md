# i18n, Legal, and Public Content

## i18n strings

Translation strings live in `messages/{locale}.json`. All 11 locale files must be kept in sync.

- **Always add new keys to `en.json` first**, then propagate to all other locales.
- Never hardcode RU-only or any single-language strings in public/legal/payment/footer/checkout/refund/privacy/consent/disclaimer text.
- Use `t()` helper from `next-intl` for all user-visible strings.
- Run `bash scripts/check-i18n.sh` to grep for hardcoded strings not wrapped in `t()`.

Supported locales: `en ru zh ko kk tj uz tk mn ky es` (defined in `src/i18n/routing.ts`).

English (`en`) uses no URL prefix. All other locales prefix with `/{locale}`.

## Legal document system

7 document types: `offer`, `privacy`, `personal-data-consent`, `refund-policy`, `disclaimer`, `terms`, `partners`.

- Types/slugs defined in `src/lib/legal/types.ts`
- Content per locale in `src/lib/legal/content/{locale}.ts` (11 locales)
- Rendered at `[locale]/legal/[slug]` via `src/app/[locale]/legal/[slug]/page.tsx`
- Aliases: `/privacy` → privacy slug; `/tos` → terms slug

When editing legal content, update all 11 locale files. Never modify legal text for one locale only.

## Public content invariants

- Do not claim "guaranteed accepted", "AI certified translation", or "automatic notarization" in any user-facing copy.
- Do not modify consent/disclaimer/refund policy wording without legal review.
- Payment compliance wording (`src/components/payment/PaymentComplianceBlock.tsx`) switches on `BUSINESS_PROFILE.cardPaymentsActive` — do not bypass this gate.

## Public pre-checkout wizard content

`/[locale]/start` and `/[locale]/checkout` UI strings live under the `startWizard` top-level key inside `messages/{locale}/order.json` — reusing the existing `order` namespace already loaded by `src/i18n/request.ts` rather than adding a new namespace file. Added to all 14 locale directories (9 enabled + 5 disabled) to satisfy `npm run i18n:check`'s structural key-parity check across every locale dir, even disabled ones. Includes the required upload-consent line (`startWizard.consentText`) and avoids "guaranteed accepted"/"AI certified translation"/"automatic notarization" wording — verified by `npm run i18n:forbidden`.

## Landing page content

Landing pages are config-driven via `LandingPageConfig` objects. Page-specific copy lives in `src/lib/landing-pages/{kazakhstan,documents,shared}.ts`. Do not hardcode section text in components — extend the config type instead.

Any localized landing page text must go through the i18n system (`messages/{locale}.json`), not be inlined as string literals.
