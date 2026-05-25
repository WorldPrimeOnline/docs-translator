import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
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

export function HeroSection({
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
  return (
    <section className="relative overflow-hidden bg-grid pb-24 pt-12 text-center sm:pb-32 sm:pt-16">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_-10%,rgba(201,168,76,0.1),transparent)]" />
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-background to-transparent" />

      <div className="relative mx-auto max-w-3xl px-4">
        {breadcrumb && breadcrumb.length > 1 && (
          <nav className="mb-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            {breadcrumb.map((item, i) => (
              <span key={item.href} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-white/20">/</span>}
                {i < breadcrumb.length - 1 ? (
                  <Link href={item.href} className="transition-colors hover:text-foreground">
                    {item.label}
                  </Link>
                ) : (
                  <span className="text-foreground/70">{item.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}

        {badge && (
          <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            {badge}
          </div>
        )}

        <h1 className="mb-5 text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
          {headline}
          {accentLine && (
            <>
              <br />
              <span className="text-primary">{accentLine}</span>
            </>
          )}
        </h1>

        <p className="mx-auto mb-8 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          {subheadline}
        </p>

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href={ctaHref}
            className="inline-flex items-center justify-center rounded-md bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
          >
            {ctaLabel}
          </Link>
          {ctaSecondaryLabel && ctaSecondaryHref && (
            <a
              href={ctaSecondaryHref}
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-8 py-3 text-sm font-medium text-foreground transition-colors hover:bg-white/10"
            >
              {ctaSecondaryLabel}
              <ChevronDown className="h-4 w-4" />
            </a>
          )}
        </div>

        {trustLine && (
          <p className="mt-6 text-xs text-muted-foreground">{trustLine}</p>
        )}
      </div>
    </section>
  );
}
