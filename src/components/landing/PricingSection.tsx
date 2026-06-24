import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { CheckCircle2 } from 'lucide-react';
import type { PricingTier } from '@/lib/landing-pages/types';
import { ServiceTermsBlock } from '@/components/payment/ServiceTermsBlock';

interface Props {
  headline: string;
  subheadline?: string;
  tiers: PricingTier[];
  footnote?: string;
}

// Keys in defaultPricingTiers that should be looked up in the landing namespace
const PRICING_KEYS = new Set([
  'pricingPassport', 'pricingOtherDocs', 'pricingElectronic', 'pricingAgentStamp', 'pricingNotarization',
  'pricingFeaturePassportDoc', 'pricingFeatureClaudeTranslation', 'pricingFeatureAiDraft',
  'pricingFeatureCleanPdf', 'pricingFeatureDelivery', 'pricingFeatureLanguages',
  'pricingFeatureDiplomas', 'pricingFeatureBankMedical',
  'pricingFeatureHumanReview', 'pricingFeatureProviderStamp', 'pricingFeatureNotaryPartner',
  'pricingCta', 'pricingFootnote', 'simplePricing', 'noSubscriptionPay', 'faqTitle',
  'pricingElectronicPrice', 'pricingAgentStampPrice', 'pricingNotarizationPrice',
]);

export async function PricingSection({ headline, subheadline, tiers, footnote }: Props) {
  const t = await getTranslations();
  const tL = await getTranslations('landing');
  const tr = (s: string): string => (PRICING_KEYS.has(s) ? tL(s as Parameters<typeof tL>[0]) : s);

  return (
    <section className="border-y border-white/[0.07] bg-card px-4 py-16 lg:py-20">
      <div className="mx-auto max-w-[860px]">
        <div className="mb-12 text-center">
          <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/70">
            {t('landing.pricingLabel')}
          </p>
          <h2 className="text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem]">
            {headline}
          </h2>
          {subheadline && (
            <p className="mt-5 text-sm text-muted-foreground">{subheadline}</p>
          )}
        </div>

        <div className={`grid gap-4 ${tiers.length > 2 ? 'sm:grid-cols-3' : tiers.length === 2 ? 'sm:grid-cols-2' : 'mx-auto max-w-xs'}`}>
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative flex flex-col overflow-hidden rounded-xl transition-all ${
                tier.highlighted
                  ? 'border border-primary/35 bg-background/70 shadow-[0_0_40px_rgba(201,168,76,0.07)]'
                  : 'border border-white/[0.08] bg-background/60'
              }`}
            >
              {/* Top accent line for highlighted */}
              {tier.highlighted && (
                <div className="absolute -top-px left-1/2 h-px w-24 -translate-x-1/2 bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
              )}

              {/* Popular badge */}
              {tier.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="rounded-full bg-primary px-3 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                    {t('landing.mostPopular')}
                  </span>
                </div>
              )}

              {/* Tier header */}
              <div className={`border-b px-6 py-5 ${tier.highlighted ? 'border-primary/15' : 'border-white/[0.06]'}`}>
                <p className={`mb-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${tier.highlighted ? 'text-primary' : 'text-muted-foreground/70'}`}>
                  {tr(tier.name)}
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="whitespace-nowrap text-3xl font-extrabold tracking-[-0.02em] text-foreground">
                    {tier.price}
                  </span>
                  <span className="text-xs text-muted-foreground">{t('landing.perDocument')}</span>
                </div>
              </div>

              {/* Features */}
              <div className="flex flex-1 flex-col p-6">
                <ul className="mb-6 flex-1 space-y-2">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px] text-muted-foreground">
                      <CheckCircle2 className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tier.highlighted ? 'text-primary/70' : 'text-muted-foreground/40'}`} />
                      {tr(f)}
                    </li>
                  ))}
                </ul>

                <Link
                  href="/auth/signup"
                  className={`inline-flex w-full items-center justify-center rounded-lg py-2.5 text-sm font-semibold transition-all duration-150 ${
                    tier.highlighted
                      ? 'bg-primary text-primary-foreground hover:bg-gold-dark hover:brightness-110'
                      : 'border border-white/15 bg-white/[0.04] text-foreground/80 hover:border-white/30 hover:bg-white/[0.07] hover:text-foreground'
                  }`}
                >
                  {tr(tier.cta)}
                </Link>
              </div>
            </div>
          ))}
        </div>

        {footnote && (
          <p className="mt-5 text-center text-[11px] text-muted-foreground/60">{tr(footnote)}</p>
        )}

        {/* Delivery, cancellation, and VAT terms — required for acquiring compliance */}
        <ServiceTermsBlock compact />
      </div>
    </section>
  );
}
