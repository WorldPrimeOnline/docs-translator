import type { SupportedDoc } from '@/lib/landing-pages/types';

interface DocGroup {
  groupLabel: string;
  items: SupportedDoc[];
}

interface PropsFlat {
  headline: string;
  subheadline?: string;
  sectionLabel?: string;
  items: SupportedDoc[];
  groups?: never;
}

interface PropsGrouped {
  headline: string;
  subheadline?: string;
  sectionLabel?: string;
  items?: never;
  groups: DocGroup[];
}

type Props = PropsFlat | PropsGrouped;

export function SupportedDocumentsSection({ headline, subheadline, sectionLabel, items, groups }: Props) {
  const hasGroups = Boolean(groups);

  return (
    <section id="documents" className="px-4 py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-12 text-center">
          <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/70">
            {sectionLabel ?? 'Supported Documents'}
          </p>
          <h2 className="text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem]">
            {headline}
          </h2>
          {subheadline && (
            <p className="mt-3 text-sm text-muted-foreground">{subheadline}</p>
          )}
        </div>

        {hasGroups ? (
          /* Grouped display */
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groups!.map(({ groupLabel, items: groupItems }) => (
              <div
                key={groupLabel}
                className="overflow-hidden rounded-xl border border-white/[0.07] bg-card transition-all duration-200 hover:border-white/[0.14]"
              >
                <div className="border-b border-white/[0.06] px-4 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary/60">
                    {groupLabel}
                  </p>
                </div>
                <div className="p-2">
                  {groupItems.map(({ icon: Icon, name }) => (
                    <div
                      key={name}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/8">
                        <Icon className="h-3.5 w-3.5 text-primary/70" />
                      </div>
                      <span className="text-[13px] font-medium text-foreground/85">{name}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Flat grid display */
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {items!.map(({ icon: Icon, name }) => (
              <div
                key={name}
                className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-card p-4 transition-all duration-200 hover:border-primary/25 hover:shadow-[0_0_20px_rgba(201,168,76,0.06)]"
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent" />
                <div className="relative flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/8">
                    <Icon className="h-4 w-4 text-primary/70" />
                  </div>
                  <span className="text-[13px] font-medium text-foreground/85">{name}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
