import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  Upload,
  Cpu,
  Download,
  IdCard,
  FileHeart,
  GraduationCap,
  Landmark,
  HeartPulse,
  Briefcase,
  Shield,
  Car,
  FileText,
  Zap,
  BadgeDollarSign,
  Lock,
  Coins,
  ChevronDown,
} from 'lucide-react';

const DOC_ICONS = [IdCard, FileHeart, GraduationCap, Landmark, HeartPulse, Briefcase, Shield, Car, FileText];

const STEP_ICONS = [Upload, Cpu, Download];

const TRUST_ICONS = [Zap, BadgeDollarSign, Coins, Lock];

const LANGUAGES = [
  { flag: '🇬🇧', name: 'English' },
  { flag: '🇷🇺', name: 'Russian' },
  { flag: '🇹🇭', name: 'Thai' },
  { flag: '🇨🇳', name: 'Chinese' },
  { flag: '🇰🇷', name: 'Korean' },
  { flag: '🇯🇵', name: 'Japanese' },
  { flag: '🇩🇪', name: 'German' },
  { flag: '🇫🇷', name: 'French' },
  { flag: '🇪🇸', name: 'Spanish' },
  { flag: '🇸🇦', name: 'Arabic' },
];

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations();

  const HOW_IT_WORKS = [
    { icon: STEP_ICONS[0]!, title: t('howItWorks.step1Title'), desc: t('howItWorks.step1Desc'), step: '01' },
    { icon: STEP_ICONS[1]!, title: t('howItWorks.step2Title'), desc: t('howItWorks.step2Desc'), step: '02' },
    { icon: STEP_ICONS[2]!, title: t('howItWorks.step3Title'), desc: t('howItWorks.step3Desc'), step: '03' },
  ];

  const DOC_TYPES = [
    { icon: DOC_ICONS[0]!, label: t('documents.passport') },
    { icon: DOC_ICONS[1]!, label: t('documents.birth') },
    { icon: DOC_ICONS[2]!, label: t('documents.diploma') },
    { icon: DOC_ICONS[3]!, label: t('documents.bank') },
    { icon: DOC_ICONS[4]!, label: t('documents.medical') },
    { icon: DOC_ICONS[5]!, label: t('documents.employment') },
    { icon: DOC_ICONS[6]!, label: t('documents.police') },
    { icon: DOC_ICONS[7]!, label: t('documents.driver') },
    { icon: DOC_ICONS[8]!, label: t('documents.other') },
  ];

  const TRUST = [
    { icon: TRUST_ICONS[0]!, title: t('trust.speed'),    desc: t('trust.speedDesc') },
    { icon: TRUST_ICONS[1]!, title: t('trust.price'),    desc: t('trust.priceDesc') },
    { icon: TRUST_ICONS[2]!, title: t('trust.ton'),      desc: t('trust.tonDesc') },
    { icon: TRUST_ICONS[3]!, title: t('trust.security'), desc: t('trust.securityDesc') },
  ];

  const FAQ = [
    { q: t('faq.q1'), a: t('faq.a1') },
    { q: t('faq.q2'), a: t('faq.a2') },
    { q: t('faq.q3'), a: t('faq.a3') },
    { q: t('faq.q4'), a: t('faq.a4') },
    { q: t('faq.q5'), a: t('faq.a5') },
  ];

  return (
    <div className="bg-background">
      {/* HERO */}
      <section className="relative overflow-hidden bg-grid px-4 pb-16 pt-20 text-center sm:pb-20 sm:pt-28">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_-10%,rgba(201,168,76,0.12),transparent)]" />
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />

        <div className="relative mx-auto max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            {t('hero.badge')}
          </div>

          <h1 className="mb-6 text-5xl font-extrabold tracking-[-0.02em] text-foreground sm:text-6xl lg:text-7xl">
            Translate Any Document
            <br />
            <span className="text-primary">in Minutes</span>
          </h1>

          <p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed text-muted-foreground">
            {t('hero.subtitle')}
          </p>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/auth/signup"
              className="inline-flex items-center justify-center rounded-md bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-[background-color,filter,transform] duration-150 hover:bg-gold-dark hover:brightness-110 hover:scale-[1.02]"
            >
              {t('hero.cta')}
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-white/20 bg-white/5 px-8 py-3 text-sm font-medium text-foreground transition-[background-color,border-color,transform] duration-150 hover:border-white/50 hover:bg-white/10 hover:scale-[1.02]"
            >
              {t('hero.seeHowItWorks')}
              <ChevronDown className="h-4 w-4" />
            </a>
          </div>

          <p className="mt-8 text-xs text-muted-foreground">
            {t('hero.socialProof')}
          </p>
        </div>

        {/* Hero UI mockup card */}
        <div className="relative mx-auto mt-14 max-w-[480px] animate-fade-in-up px-4">
          <div className="pointer-events-none absolute -inset-6 rounded-2xl bg-[radial-gradient(ellipse_80%_60%_at_50%_50%,rgba(201,168,76,0.05),transparent)]" />
          <div className="relative overflow-hidden rounded-xl border border-white/12 bg-card shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between border-b border-white/8 px-5 py-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-medium text-foreground">passport_scan.pdf</span>
              </div>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {t('dashboard.completed')}
              </span>
            </div>
            <div className="flex items-center gap-3 border-b border-white/5 px-5 py-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-sm">🇷🇺</div>
              <div className="h-px w-6 bg-white/15" />
              <svg className="h-3 w-3 text-muted-foreground" fill="none" viewBox="0 0 12 12"><path d="M2 6h8M7 3l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <div className="h-px w-6 bg-white/15" />
              <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-sm">🇬🇧</div>
              <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
                <Zap className="h-3 w-3 text-primary" />
                3 min 42 sec
              </div>
            </div>
            <div className="flex items-center justify-between px-5 py-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold text-foreground">{t('hero.translationReady')}</span>
                <span className="text-[10px] text-muted-foreground">{t('hero.mockupSub')}</span>
              </div>
              <div className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                <Download className="h-3 w-3" />
                {t('hero.downloadPdf')}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF STRIPE */}
      <div className="border-y border-white/8 bg-white/[0.02] px-4 py-6">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-5 sm:flex-row sm:justify-center sm:divide-x sm:divide-white/10 sm:gap-0">
          <div className="px-8 text-center">
            <p className="text-2xl font-extrabold tracking-[-0.02em] text-primary">{t('stats.documentCount')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('stats.documentsLabel')}</p>
          </div>
          <div className="px-8 text-center">
            <p className="text-2xl font-extrabold tracking-[-0.02em] text-primary">{t('stats.countriesCount')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('stats.countriesLabel')}</p>
          </div>
          <div className="px-8 text-center">
            <p className="text-2xl font-extrabold tracking-[-0.02em] text-primary">{t('stats.rating')}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t('stats.ratingLabel')}</p>
          </div>
        </div>
      </div>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="px-4 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
              {t('howItWorks.label')}
            </p>
            <h2 className="text-3xl font-bold tracking-[-0.02em] text-foreground sm:text-4xl">
              {t('howItWorks.title')}
            </h2>
          </div>

          <div className="relative grid gap-8 sm:grid-cols-3">
            <div className="absolute left-1/6 right-1/6 top-7 hidden h-px bg-gradient-to-r from-transparent via-white/10 to-transparent sm:block" />
            {HOW_IT_WORKS.map((step) => (
              <div key={step.step} className="flex flex-col items-center text-center">
                <div className="relative mb-5">
                  <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/10 bg-card shadow-lg">
                    <step.icon className="h-6 w-6 text-primary" />
                  </div>
                  <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {step.step.slice(-1)}
                  </span>
                </div>
                <h3 className="mb-2 text-base font-semibold text-foreground">{step.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DOCUMENT TYPES */}
      <section className="border-y border-white/10 bg-card px-4 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
              {t('documents.label')}
            </p>
            <h2 className="text-3xl font-bold tracking-[-0.02em] text-foreground sm:text-4xl">
              {t('documents.title')}
            </h2>
            <p className="mt-3 text-muted-foreground">{t('documents.subtitle')}</p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {DOC_TYPES.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="group flex items-center gap-3 rounded-lg border border-white/8 bg-background/60 p-4 transition-[border-color,box-shadow] duration-200 hover:border-primary/30 hover:shadow-[0_0_20px_rgba(201,168,76,0.08)]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <Icon className="h-6 w-6 text-primary" />
                </div>
                <span className="text-sm font-medium text-foreground">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* LANGUAGES */}
      <section className="px-4 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
              {t('stats.languagePairs')}
            </p>
            <h2 className="text-3xl font-bold tracking-[-0.02em] text-foreground sm:text-4xl">
              {t('stats.languagePairsLabel')}
            </h2>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {LANGUAGES.map(({ flag, name }) => (
              <div
                key={name}
                className="flex items-center gap-3 rounded-lg border border-white/8 bg-card p-3 transition-colors hover:border-white/15"
              >
                <span className="text-lg">{flag}</span>
                <span className="text-sm font-medium text-foreground">{name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="border-y border-white/10 bg-card px-4 py-24">
        <div className="mx-auto max-w-5xl">
          <div className="mb-14 text-center">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
              {t('pricing.label')}
            </p>
            <h2 className="text-3xl font-bold tracking-[-0.02em] text-foreground sm:text-4xl">
              {t('pricing.title')}
            </h2>
            <p className="mt-3 text-muted-foreground">
              {t('pricing.subtitle')}
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-3">
            {/* PAY AS YOU GO */}
            <div className="flex flex-col rounded-lg border border-white/10 bg-background/60 p-7">
              <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {t('pricing.payg')}
              </div>
              <div className="mb-2 flex items-end gap-1">
                <span className="text-4xl font-extrabold tracking-[-0.02em] text-foreground">$4.39</span>
                <span className="mb-1 text-sm text-muted-foreground">{t('pricing.perDoc')}</span>
              </div>
              <p className="mb-5 text-xs text-muted-foreground">{t('pricing.paygNote')}</p>
              <ul className="mb-7 flex-1 space-y-2 text-sm text-muted-foreground">
                {[t('pricing.feature1'), t('pricing.feature2'), t('pricing.feature3'), t('pricing.feature4')].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 text-muted-foreground">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/signup"
                className="inline-flex w-full items-center justify-center rounded-md border border-white/20 bg-white/5 py-2.5 text-sm font-semibold text-foreground transition-[background-color,border-color,transform] duration-150 hover:border-white/50 hover:bg-white/10 hover:scale-[1.02]"
              >
                {t('pricing.startTranslating')}
              </Link>
            </div>

            {/* BASIC */}
            <div className="relative flex flex-col rounded-lg border border-primary/50 bg-primary/5 p-7 shadow-lg shadow-primary/10">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">
                  {t('pricing.mostPopular')}
                </span>
              </div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
                {t('pricing.basic')}
              </div>
              <div className="mb-2 flex items-end gap-1">
                <span className="text-4xl font-extrabold tracking-[-0.02em] text-foreground">$9.99</span>
                <span className="mb-1 text-sm text-muted-foreground">{t('pricing.perMonth')}</span>
              </div>
              <p className="mb-5 text-xs text-muted-foreground">10 {t('pricing.docs')}.</p>
              <ul className="mb-7 flex-1 space-y-2 text-sm text-muted-foreground">
                {[`10 ${t('pricing.docs')}`, t('pricing.allDocTypes'), t('pricing.aiTranslation'), t('pricing.cleanPdf'), t('pricing.dayAccess')].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 text-primary">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/signup"
                className="inline-flex w-full items-center justify-center rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-[background-color,filter,transform] duration-150 hover:bg-gold-dark hover:brightness-110 hover:scale-[1.02]"
              >
                {t('pricing.subscribe')}
              </Link>
            </div>

            {/* PRO */}
            <div className="flex flex-col rounded-lg border border-white/10 bg-background/60 p-7">
              <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {t('pricing.pro')}
              </div>
              <div className="mb-2 flex items-end gap-1">
                <span className="text-4xl font-extrabold tracking-[-0.02em] text-foreground">$24.99</span>
                <span className="mb-1 text-sm text-muted-foreground">{t('pricing.perMonth')}</span>
              </div>
              <p className="mb-5 text-xs text-muted-foreground">40 {t('pricing.docs')}. {t('pricing.proDesc')}</p>
              <ul className="mb-7 flex-1 space-y-2 text-sm text-muted-foreground">
                {[`40 ${t('pricing.docs')}`, t('pricing.allDocTypes'), t('pricing.aiTranslation'), t('pricing.cleanPdf'), t('pricing.priorityProcessing'), t('pricing.proBadge')].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 text-primary">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/signup"
                className="inline-flex w-full items-center justify-center rounded-md border border-white/20 bg-white/5 py-2.5 text-sm font-semibold text-foreground transition-[background-color,border-color,transform] duration-150 hover:border-white/50 hover:bg-white/10 hover:scale-[1.02]"
              >
                {t('pricing.subscribe')}
              </Link>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            {t('pricing.allPricesNote')}
          </p>
        </div>
      </section>

      {/* WHY WPO */}
      <section className="px-4 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
              {t('trust.label')}
            </p>
            <h2 className="text-3xl font-bold tracking-[-0.02em] text-foreground sm:text-4xl">
              {t('trust.title')}
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-lg border border-white/10 bg-card p-6 transition-colors hover:border-white/15">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <h3 className="mb-1.5 text-sm font-semibold text-foreground">{title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TRUST PILLARS */}
      <section className="border-y border-white/10 bg-card px-4 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold tracking-[-0.02em] text-foreground sm:text-4xl">
              {t('trust.sectionTitle')}
            </h2>
            <p className="mt-3 text-muted-foreground">
              {t('trust.sectionSubtitle')}
            </p>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              { Icon: Lock,  head: t('trust.pillar1Title'), body: t('trust.pillar1Body') },
              { Icon: Cpu,   head: t('trust.pillar2Title'), body: t('trust.pillar2Body') },
              { Icon: Coins, head: t('trust.pillar3Title'), body: t('trust.pillar3Body') },
            ].map(({ Icon, head, body }) => (
              <div key={head} className="rounded-xl border border-white/10 bg-background/60 p-8">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-2 text-base font-semibold tracking-[-0.02em] text-foreground">{head}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-4 py-24">
        <div className="mx-auto max-w-2xl">
          <div className="mb-14 text-center">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
              {t('faq.label')}
            </p>
            <h2 className="text-3xl font-bold tracking-[-0.02em] text-foreground sm:text-4xl">
              {t('faq.title')}
            </h2>
          </div>

          <div className="space-y-2">
            {FAQ.map(({ q, a }) => (
              <details key={q} className="group rounded-lg border border-white/10 bg-card px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium text-foreground">
                  {q}
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="relative overflow-hidden border-t border-white/10 px-4 py-32 text-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgba(201,168,76,0.07),transparent)]" />
        <div className="relative mx-auto max-w-xl">
          <h2 className="mb-4 text-3xl font-bold tracking-[-0.02em] text-foreground sm:text-4xl lg:text-5xl">
            {t('cta.title')}
          </h2>
          <p className="mb-10 text-muted-foreground">
            {t('cta.subtitle')}
          </p>
          <Link
            href="/auth/signup"
            className="inline-flex items-center justify-center rounded-md bg-primary px-10 py-3 text-sm font-semibold text-primary-foreground transition-[background-color,filter,transform] duration-150 hover:bg-gold-dark hover:brightness-110 hover:scale-[1.02]"
          >
            {t('cta.button')}
          </Link>
          <p className="mt-4 text-xs text-muted-foreground">
            {t('cta.noSub')}
          </p>
        </div>
      </section>
    </div>
  );
}
