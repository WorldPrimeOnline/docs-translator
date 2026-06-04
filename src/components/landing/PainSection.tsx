import { AlertCircle, Zap } from 'lucide-react';
import type { PainPoint } from '@/lib/landing-pages/types';

interface Props {
  headline: string;
  points: PainPoint[];
  sectionLabel?: string;
  bridgeLabel?: string;
}

export function PainSection({ headline, points, sectionLabel, bridgeLabel }: Props) {
  return (
    <section className="border-b border-white/[0.07] bg-card px-4 py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-12 text-center">
          <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/70">
            {sectionLabel ?? 'The Problem'}
          </p>
          <h2 className="mx-auto max-w-2xl text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem]">
            {headline}
          </h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {points.map(({ title, desc }) => (
            <div
              key={title}
              className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-background/50 p-5 transition-all duration-200 hover:border-white/15 hover:bg-background/80"
            >
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent" />
              <div className="relative flex gap-4">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/8 ring-1 ring-destructive/15">
                  <AlertCircle className="h-4 w-4 text-destructive/70" />
                </div>
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold text-foreground">{title}</h3>
                  <p className="text-[13px] leading-relaxed text-muted-foreground/80">{desc}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Bridge */}
        <div className="mt-10 flex items-center justify-center gap-3">
          <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/[0.06]" />
          <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary">
            <Zap className="h-3 w-3" />
            {bridgeLabel ?? 'WPO solves this'}
          </div>
          <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/[0.06]" />
        </div>
      </div>
    </section>
  );
}
