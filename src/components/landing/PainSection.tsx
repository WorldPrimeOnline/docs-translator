import type { PainPoint } from '@/lib/landing-pages/types';
import { AlertCircle } from 'lucide-react';

interface Props {
  headline: string;
  points: PainPoint[];
}

export function PainSection({ headline, points }: Props) {
  return (
    <section className="border-y border-white/10 bg-card px-4 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
            The Problem
          </p>
          <h2 className="mx-auto max-w-2xl text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {headline}
          </h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {points.map(({ title, desc }) => (
            <div
              key={title}
              className="flex gap-4 rounded-lg border border-white/8 bg-background/60 p-5"
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-destructive/10">
                <AlertCircle className="h-4 w-4 text-destructive" />
              </div>
              <div>
                <h3 className="mb-1 text-sm font-semibold text-foreground">{title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
