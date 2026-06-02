# Payment Logo Assets — REQUIRED BEFORE PRODUCTION

This directory must contain official payment brand assets before the site goes live with Halyk Bank
internet acquiring. Using unofficial, downloaded-from-internet, or AI-generated logos violates
payment brand guidelines and will cause acquiring approval to be rejected.

## Required files

| Filename              | Source                                                    | Notes |
|-----------------------|-----------------------------------------------------------|-------|
| `halyk-epay.svg`      | Provided by your Halyk Bank relationship manager OR obtained from the Halyk ePay merchant portal | The official informer/logo that links to http://epay.homebank.kz/ |
| `visa.svg`            | https://usa.visa.com/run-your-business/merchant-logos.html (requires merchant account login) | Visa Acceptance Mark |
| `mastercard.svg`      | https://brand.mastercard.com/brandcenter/more-about-our-brands.html | Mastercard Acceptance Mark |

## How to use

After placing files here, update `src/components/payment/PaymentComplianceBlock.tsx`:
- Replace the inline `<HalykEpayLogo />` SVG component with `<Image src="/payment-logos/halyk-epay.svg" ... />`
- Replace the inline `<VisaLogo />` SVG component with `<Image src="/payment-logos/visa.svg" ... />`
- Replace the inline `<MastercardLogo />` SVG component with `<Image src="/payment-logos/mastercard.svg" ... />`

## Current state

The website currently renders **placeholder SVG logos** (text-only rectangles) defined inline in
`PaymentComplianceBlock.tsx`. These are clearly visible development placeholders — they must be
replaced with official assets before submitting the site to Halyk Bank for acquiring approval.

## Do NOT

- Download logos from Google Images, Wikipedia, or unofficial sources.
- Use AI-generated logo approximations.
- Modify official brand assets without permission from the brand owner.
