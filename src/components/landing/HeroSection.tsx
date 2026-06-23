import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Upload, ChevronDown, FileText, ArrowRight, Download, Zap } from 'lucide-react';
import type { BreadcrumbItem } from '@/lib/landing-pages/types';

interface HeroSectionProps {
  badge?: string;
  headline: string;
  accentLine?: string;
  subheadline: string;
  ctaLabel: string;
  ctaHref: string;
  ctaSecondaryLabel?: string;
  ctaSecondaryHref?: string;
  trustLine?: string;
  breadcrumb?: BreadcrumbItem[];
}

export async function HeroSection({
  badge,
  headline,
  accentLine,
  subheadline,
  ctaLabel,
  ctaHref,
  ctaSecondaryLabel,
  ctaSecondaryHref,
  trustLine,
  breadcrumb,
}: HeroSectionProps) {
  const tCommon = await getTranslations('mockup');
  return (
    <section className="relative overflow-hidden bg-grid pb-20 pt-14 sm:pb-24 sm:pt-20">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_55%_at_50%_-5%,rgba(201,168,76,0.09),transparent)]" />
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />

      <div className="relative mx-auto max-w-3xl px-4 text-center">

        {/* Breadcrumb */}
        {breadcrumb && breadcrumb.length > 1 && (
          <nav className="mb-6 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            {breadcrumb.map((item, i) => (
              <span key={item.href} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-white/20">/</span>}
                {i < breadcrumb.length - 1 ? (
                  <Link href={item.href} className="transition-colors hover:text-foreground">
                    {item.label}
                  </Link>
                ) : (
                  <span className="text-foreground/60">{item.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}

        {/* Badge */}
        {badge && (
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground backdrop-blur-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            {badge}
          </div>
        )}

        {/* Headline */}
        <h1 className="mb-5 text-[2.4rem] font-extrabold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-[3.2rem]">
          {headline}
          {accentLine && (
            <>
              <br />
              <span className="text-primary">{accentLine}</span>
            </>
          )}
        </h1>

        {/* Subheadline */}
        <p className="mx-auto mb-8 max-w-[500px] text-base leading-relaxed text-muted-foreground sm:text-[1.05rem]">
          {subheadline}
        </p>

        {/* CTAs */}
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href={ctaHref}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-7 py-3 text-sm font-semibold text-primary-foreground transition-all duration-150 hover:bg-gold-dark hover:brightness-110 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <Upload className="h-4 w-4" />
            {ctaLabel}
          </Link>
          {ctaSecondaryLabel && ctaSecondaryHref && (
            <a
              href={ctaSecondaryHref}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-7 py-3 text-sm font-medium text-foreground/80 transition-all duration-150 hover:border-white/30 hover:bg-white/[0.07] hover:text-foreground"
            >
              {ctaSecondaryLabel}
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </a>
          )}
        </div>

        {/* Trust row */}
        {trustLine && (
          <p className="mt-6 text-[11px] text-muted-foreground/70">{trustLine}</p>
        )}
      </div>

      {/* Compact product mockup for vertical pages */}
      <div className="relative mx-auto mt-12 max-w-[420px] animate-fade-in-up px-4">
        <div className="pointer-events-none absolute -inset-6 rounded-2xl bg-[radial-gradient(ellipse_70%_50%_at_50%_50%,rgba(201,168,76,0.05),transparent)]" />
        <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#121f33] shadow-2xl shadow-black/50">

          {/* Top bar */}
          <div className="flex items-center justify-between border-b border-white/8 bg-white/[0.02] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-muted-foreground/60" />
              <span className="text-[11px] font-medium text-foreground/70">document.pdf</span>
            </div>
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {tCommon('statusReady')}
            </span>
          </div>

          {/* Lang pair */}
          <div className="flex items-center gap-2.5 border-b border-white/6 px-4 py-3">
            <span className="text-sm">🇷🇺</span>
            <ArrowRight className="h-3 w-3 text-white/20" />
            <span className="text-sm">🇬🇧</span>
            <div className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground">
              <Zap className="h-3 w-3 text-primary/60" />
              3m 42s
            </div>
          </div>

          {/* Download row */}
          <div className="flex items-center justify-between px-4 py-3.5">
            <div>
              <p className="text-[11px] font-semibold text-foreground">{tCommon('translationReady')}</p>
              <p className="text-[10px] text-muted-foreground">{tCommon('pdfGenerated')}</p>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[10px] font-semibold text-primary-foreground">
              <Download className="h-3 w-3" />
              {tCommon('download')}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
