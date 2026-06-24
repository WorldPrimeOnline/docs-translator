import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { CheckCircle2 } from 'lucide-react';
import type { PricingTier } from '@/lib/landing-pages/types';
import { ServiceTermsBlock } from '@/components/payment/ServiceTermsBlock';

interface TierData {
  title: string;
  price: string;
  unit: string;
  features: string[];
  cta: string;
}

interface Props {
  headline: string;
  subheadline?: string;
  tiers: PricingTier[];
  footnote?: string;
}

export async function PricingSection({ headline, subheadline, tiers, footnote }: Props) {
  const tp = await getTranslations('pricing');
  const tiersRaw = tp.raw('tiers') as Record<string, TierData>;

  return (
    <section className="border-y border-white/[0.07] bg-card px-4 py-16 lg:py-20">
      <div className="mx-auto max-w-[860px]">
        <div className="mb-12 text-center">
          <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/70">
            {tp('label')}
          </p>
          <h2 className="text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem]">
            {headline}
          </h2>
          {subheadline && (
            <p className="mt-5 text-sm text-muted-foreground">{subheadline}</p>
          )}
        </div>

        <div className={`grid gap-4 ${tiers.length > 2 ? 'sm:grid-cols-3' : tiers.length === 2 ? 'sm:grid-cols-2' : 'mx-auto max-w-xs'}`}>
          {tiers.map((tier) => {
            const td = tiersRaw[tier.id] as TierData | undefined;
            if (!td) return null;

            return (
              <div
                key={tier.id}
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

                {/* Tier header */}
                <div className={`border-b px-6 py-5 ${tier.highlighted ? 'border-primary/15' : 'border-white/[0.06]'}`}>
                  {/* Popular badge — inside header, no overflow */}
                  {tier.highlighted && (
                    <div className="mb-2">
                      <span className="inline-block rounded-full bg-primary px-3 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                        {tp('mostPopular')}
                      </span>
                    </div>
                  )}

                  <p className={`mb-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${tier.highlighted ? 'text-primary' : 'text-muted-foreground/70'}`}>
                    {td.title}
                  </p>
                  <div className="space-y-0.5">
                    <div className="whitespace-nowrap text-3xl font-extrabold tracking-[-0.02em] text-foreground">
                      {td.price}
                    </div>
                    <div className="text-xs text-muted-foreground">{td.unit}</div>
                  </div>
                </div>

                {/* Features */}
                <div className="flex flex-1 flex-col p-6">
                  <ul className="mb-6 flex-1 space-y-2">
                    {td.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-[13px] text-muted-foreground">
                        <CheckCircle2 className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${tier.highlighted ? 'text-primary/70' : 'text-muted-foreground/40'}`} />
                        {f}
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
                    {td.cta}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-5 text-center text-[11px] text-muted-foreground/60">
          {footnote ? tp(footnote as Parameters<typeof tp>[0]) : tp('allPricesNote')}
        </p>

        {/* Delivery, cancellation, and VAT terms — required for acquiring compliance */}
        <ServiceTermsBlock compact />
      </div>
    </section>
  );
}
