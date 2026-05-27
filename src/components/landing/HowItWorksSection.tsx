import { getTranslations } from 'next-intl/server';
import { Upload, FileCheck, CreditCard, Download, ArrowRight } from 'lucide-react';

const STEP_ICONS = [Upload, FileCheck, CreditCard, Download];

export async function HowItWorksSection() {
  const t = await getTranslations();

  const steps = [
    {
      n: '01',
      icon: STEP_ICONS[0]!,
      title: t('howItWorks.step1Title'),
      desc: t('howItWorks.step1Desc'),
    },
    {
      n: '02',
      icon: STEP_ICONS[1]!,
      title: t('howItWorks.step2Title'),
      desc: t('howItWorks.step2Desc'),
    },
    {
      n: '03',
      icon: STEP_ICONS[2]!,
      title: t('pricing.payg'),
      desc: t('pricing.allPricesNote'),
    },
    {
      n: '04',
      icon: STEP_ICONS[3]!,
      title: t('howItWorks.step3Title'),
      desc: t('howItWorks.step3Desc'),
    },
  ];

  return (
    <section id="how-it-works" className="border-y border-white/[0.07] bg-card px-4 py-20">
      <div className="mx-auto max-w-5xl">
        <div className="mb-14 text-center">
          <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/70">
            {t('howItWorks.label')}
          </p>
          <h2 className="text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem]">
            {t('howItWorks.title')}
          </h2>
        </div>

        <div className="relative">
          {/* Connector line — desktop only */}
          <div className="absolute left-[12.5%] right-[12.5%] top-7 hidden h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent lg:block" />

          <div className="grid gap-6 lg:grid-cols-4">
            {steps.map((step, i) => (
              <div
                key={step.n}
                className="relative flex flex-col items-center text-center lg:items-start lg:text-left"
              >
                {/* Mobile connector */}
                {i < 3 && (
                  <div className="my-3 flex w-full justify-center lg:hidden">
                    <ArrowRight className="h-4 w-4 rotate-90 text-white/15" />
                  </div>
                )}

                {/* Icon + step number */}
                <div className="relative mb-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/10 bg-background shadow-lg">
                    <step.icon className="h-5 w-5 text-primary" />
                  </div>
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {step.n.slice(-1)}
                  </span>
                </div>

                <h3 className="mb-1.5 text-sm font-semibold text-foreground">{step.title}</h3>
                <p className="max-w-[200px] text-[13px] leading-relaxed text-muted-foreground">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
