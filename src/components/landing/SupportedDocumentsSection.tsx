import type { SupportedDoc } from '@/lib/landing-pages/types';

interface Props {
  headline: string;
  subheadline?: string;
  items: SupportedDoc[];
}

export function SupportedDocumentsSection({ headline, subheadline, items }: Props) {
  return (
    <section id="documents" className="px-4 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
            Supported Documents
          </p>
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {headline}
          </h2>
          {subheadline && (
            <p className="mt-3 text-sm text-muted-foreground">{subheadline}</p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {items.map(({ icon: Icon, name }) => (
            <div
              key={name}
              className="flex items-center gap-3 rounded-lg border border-white/8 bg-card p-4 transition-colors hover:border-white/15"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <span className="text-sm font-medium text-foreground">{name}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
