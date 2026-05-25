import { getTranslations } from 'next-intl/server';

export async function HowItWorksSection() {
  const t = await getTranslations();

  const steps = [
    { n: '01', title: t('howItWorks.step1Title'), desc: t('howItWorks.step1Desc') },
    { n: '02', title: t('howItWorks.step2Title'), desc: t('howItWorks.step2Desc') },
    { n: '03', title: t('howItWorks.step3Title'), desc: t('howItWorks.step3Desc') },
  ];

  return (
    <section className="border-y border-white/10 bg-card px-4 py-20">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
            {t('landing.processLabel')}
          </p>
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            {t('howItWorks.title')}
          </h2>
        </div>

        <div className="grid gap-8 sm:grid-cols-3">
          {steps.map((step) => (
            <div key={step.n} className="flex flex-col items-center text-center">
              <div className="relative mb-5">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/10 bg-background shadow-lg">
                  <span className="text-lg font-bold text-primary">{step.n}</span>
                </div>
              </div>
              <h3 className="mb-2 text-sm font-semibold text-foreground">{step.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
