import Link from 'next/link';
import type { PricingTier } from '@/lib/landing-pages/types';

interface Props {
  headline: string;
  subheadline?: string;
  tiers: PricingTier[];
  footnote?: string;
}

export function PricingSection({ headline, subheadline, tiers, footnote }: Props) {
  return (
    <section className="border-y border-white/10 bg-card px-4 py-20">
      <div className="mx-auto max-w-3xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
            Pricing
          </p>
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {headline}
          </h2>
          {subheadline && (
            <p className="mt-3 text-sm text-muted-foreground">{subheadline}</p>
          )}
        </div>

        <div className={`grid gap-4 ${tiers.length > 1 ? 'sm:grid-cols-2' : 'max-w-sm mx-auto'}`}>
          {tiers.map((tier) => (
            <div
              key={tier.name}
              className={`relative rounded-lg p-7 ${
                tier.highlighted
                  ? 'border border-primary/40 bg-background/60 shadow-lg shadow-primary/5'
                  : 'border border-white/10 bg-background/60'
              }`}
            >
              {tier.highlighted && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">
                    Most popular
                  </span>
                </div>
              )}

              <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
                {tier.name}
              </div>
              <div className="mb-5 flex items-end gap-1">
                <span className="text-4xl font-bold tracking-tight text-foreground">
                  {tier.price}
                </span>
                <span className="mb-1 text-sm text-muted-foreground">per document</span>
              </div>

              <ul className="mb-6 space-y-2 text-sm text-muted-foreground">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className={`mt-0.5 ${tier.highlighted ? 'text-primary' : 'text-muted-foreground'}`}>
                      ✓
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href="/auth/signup"
                className={`inline-flex w-full items-center justify-center rounded-md py-2.5 text-sm font-semibold transition-colors ${
                  tier.highlighted
                    ? 'bg-primary text-primary-foreground hover:bg-gold-dark'
                    : 'border border-white/15 bg-white/5 text-foreground hover:bg-white/10'
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        {footnote && (
          <p className="mt-5 text-center text-xs text-muted-foreground">{footnote}</p>
        )}
      </div>
    </section>
  );
}
