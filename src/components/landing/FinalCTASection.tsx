import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Upload } from 'lucide-react';

interface Props {
  headline: string;
  sub?: string;
  cta: string;
  ctaHref?: string;
}

export async function FinalCTASection({ headline, sub, cta, ctaHref = '/auth/signup' }: Props) {
  const t = await getTranslations();

  return (
    <section className="relative overflow-hidden border-t border-white/[0.07] px-4 py-28 text-center">
      {/* Background radial */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_70%_at_50%_50%,rgba(201,168,76,0.065),transparent)]" />
      {/* Subtle grid */}
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />

      <div className="relative mx-auto max-w-[520px]">
        {/* Eyebrow */}
        <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/60">
          {t('trust.label')}
        </p>

        <h2 className="mb-5 text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem] lg:text-[2.2rem]">
          {headline}
        </h2>

        {sub && (
          <p className="mb-9 text-sm leading-relaxed text-muted-foreground sm:text-[0.95rem]">
            {sub}
          </p>
        )}

        <Link
          href={ctaHref}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-all duration-150 hover:bg-gold-dark hover:brightness-110 hover:scale-[1.02]"
        >
          <Upload className="h-4 w-4" />
          {cta}
        </Link>

        <p className="mt-5 text-[11px] text-muted-foreground/60">
          {t('landing.noSubscription')}
        </p>

      </div>
    </section>
  );
}
