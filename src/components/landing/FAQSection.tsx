'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import type { FAQ } from '@/lib/landing-pages/types';

interface Props {
  headline?: string;
  items: FAQ[];
}

export function FAQSection({ headline = 'Frequently asked questions', items }: Props) {
  const t = useTranslations('landing');
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className="px-4 py-20">
      <div className="mx-auto max-w-2xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
            {t('faqLabel')}
          </p>
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {headline}
          </h2>
        </div>

        <div className="space-y-2">
          {items.map(({ q, a }, i) => (
            <div key={i} className="rounded-lg border border-white/10 bg-card">
              <button
                type="button"
                onClick={() => setOpen(open === i ? null : i)}
                className="flex w-full items-center justify-between px-5 py-4 text-left"
              >
                <span className="pr-4 text-sm font-medium text-foreground">{q}</span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                    open === i ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {open === i && (
                <div className="border-t border-white/10 px-5 pb-5 pt-3">
                  <p className="text-sm leading-relaxed text-muted-foreground">{a}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
