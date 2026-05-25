import Link from 'next/link';

interface Props {
  headline: string;
  sub?: string;
  cta: string;
  ctaHref?: string;
}

export function FinalCTASection({ headline, sub, cta, ctaHref = '/auth/signup' }: Props) {
  return (
    <section className="relative overflow-hidden px-4 py-28 text-center">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgba(201,168,76,0.07),transparent)]" />
      <div className="relative mx-auto max-w-xl">
        <h2 className="mb-4 text-2xl font-bold tracking-tight text-foreground sm:text-3xl lg:text-4xl">
          {headline}
        </h2>
        {sub && (
          <p className="mb-8 text-sm text-muted-foreground sm:text-base">{sub}</p>
        )}
        <Link
          href={ctaHref}
          className="inline-flex items-center justify-center rounded-md bg-primary px-10 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
        >
          {cta}
        </Link>
        <p className="mt-4 text-xs text-muted-foreground">
          No subscription · Pay only when you translate
        </p>
      </div>
    </section>
  );
}
