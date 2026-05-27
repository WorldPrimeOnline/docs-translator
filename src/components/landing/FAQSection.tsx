'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Minus } from 'lucide-react';
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
      <div className="mx-auto max-w-[640px]">
        <div className="mb-12 text-center">
          <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/70">
            {t('faqLabel')}
          </p>
          <h2 className="text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem]">
            {headline}
          </h2>
        </div>

        <div className="space-y-1.5">
          {items.map(({ q, a }, i) => {
            const isOpen = open === i;
            return (
              <div
                key={i}
                className={`overflow-hidden rounded-xl border transition-all duration-200 ${
                  isOpen
                    ? 'border-white/[0.12] bg-card/80'
                    : 'border-white/[0.07] bg-card hover:border-white/[0.1]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex w-full items-center justify-between px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30"
                  aria-expanded={isOpen}
                >
                  <span className="pr-4 text-sm font-medium text-foreground/90 leading-snug">{q}</span>
                  <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-all duration-200 ${
                    isOpen ? 'bg-primary/10 text-primary' : 'bg-white/[0.05] text-muted-foreground/60'
                  }`}>
                    {isOpen ? (
                      <Minus className="h-3 w-3" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                  </span>
                </button>

                {/* Answer with smooth reveal */}
                <div
                  className={`overflow-hidden transition-all duration-200 ease-out ${
                    isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
                  }`}
                >
                  <div className="border-t border-white/[0.06] px-5 pb-5 pt-3.5">
                    <p className="text-[13px] leading-relaxed text-muted-foreground/85">{a}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
