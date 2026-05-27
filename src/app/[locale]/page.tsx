import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  Upload,
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
  Lock,
  Clock,
  Globe,
  Server,
  Trash2,
  Eye,
  ChevronDown,
  CheckCircle2,
  FileCheck,
  Cpu,
  Plane,
  Building2,
  CreditCard,
  MapPin,
  ArrowRight,
} from 'lucide-react';

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations();

  const DOC_CATEGORIES = [
    {
      label: 'Identity',
      items: [
        { icon: IdCard,        label: t('documents.passport') },
        { icon: Car,           label: t('documents.driver') },
      ],
    },
    {
      label: 'Financial',
      items: [
        { icon: Landmark,      label: t('documents.bank') },
        { icon: Briefcase,     label: t('documents.employment') },
      ],
    },
    {
      label: 'Education',
      items: [
        { icon: GraduationCap, label: t('documents.diploma') },
        { icon: FileText,      label: 'Transcript' },
      ],
    },
    {
      label: 'Legal / Civil',
      items: [
        { icon: FileHeart,     label: t('documents.birth') },
        { icon: Shield,        label: t('documents.police') },
      ],
    },
    {
      label: 'Medical',
      items: [
        { icon: HeartPulse,    label: t('documents.medical') },
      ],
    },
    {
      label: 'Other',
      items: [
        { icon: FileText,      label: t('documents.other') },
      ],
    },
  ];

  const TRUST_ITEMS = [
    { icon: Zap,     title: t('trust.speed'),    desc: t('trust.speedDesc') },
    { icon: Lock,    title: t('trust.security'), desc: t('trust.securityDesc') },
    { icon: Cpu,     title: t('trust.pillar2Title'), desc: t('trust.pillar2Body') },
    { icon: Globe,   title: t('trust.ton'),      desc: t('trust.tonDesc') },
  ];

  const PAIN_ITEMS = [
    { icon: Clock,   title: t('pain.item1Title'), desc: t('pain.item1Desc') },
    { icon: Zap,     title: t('pain.item2Title'), desc: t('pain.item2Desc') },
    { icon: CreditCard, title: t('pain.item3Title'), desc: t('pain.item3Desc') },
    { icon: Globe,   title: t('pain.item4Title'), desc: t('pain.item4Desc') },
  ];

  const SECURITY_ITEMS = [
    { icon: Server,  title: t('security.item1Title'), desc: t('security.item1Desc') },
    { icon: Trash2,  title: t('security.item2Title'), desc: t('security.item2Desc') },
    { icon: Eye,     title: t('security.item3Title'), desc: t('security.item3Desc') },
    { icon: Shield,  title: t('security.item4Title'), desc: t('security.item4Desc') },
  ];

  const USE_CASES = [
    { icon: Plane,     title: t('useCases.visa'),        desc: t('useCases.visaDesc') },
    { icon: GraduationCap, title: t('useCases.university'), desc: t('useCases.universityDesc') },
    { icon: Building2, title: t('useCases.banking'),     desc: t('useCases.bankingDesc') },
    { icon: MapPin,    title: t('useCases.relocation'),  desc: t('useCases.relocationDesc') },
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

      {/* ─────────────────────────────────────────
          HERO
      ───────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-grid pb-20 pt-16 sm:pb-28 sm:pt-24">
        {/* Radial background glow */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_55%_at_50%_-5%,rgba(201,168,76,0.09),transparent)]" />
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-background to-transparent" />

        <div className="relative mx-auto max-w-4xl px-4 text-center">
          {/* Badge */}
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground backdrop-blur-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            {t('hero.badge')}
          </div>

          {/* Headline */}
          <h1 className="mb-6 text-[2.6rem] font-extrabold leading-[1.1] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-[3.5rem]">
            {t('hero.title')}
            <br />
            <span className="text-primary">{t('hero.accentLine')}</span>
          </h1>

          {/* Subheadline */}
          <p className="mx-auto mb-9 max-w-[520px] text-base leading-relaxed text-muted-foreground sm:text-[1.05rem]">
            {t('hero.subtitle')}
          </p>

          {/* CTA row */}
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/auth/signup"
              className="group inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-7 py-3 text-sm font-semibold text-primary-foreground transition-all duration-150 hover:bg-gold-dark hover:brightness-110 hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              <Upload className="h-4 w-4" />
              {t('hero.cta')}
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-7 py-3 text-sm font-medium text-foreground/80 transition-all duration-150 hover:border-white/30 hover:bg-white/[0.07] hover:text-foreground"
            >
              {t('hero.seeHowItWorks')}
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </a>
          </div>

          {/* Trust row */}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {[
              t('trust.speed'),
              t('trust.security'),
              t('trust.pillar2Title'),
            ].map((item) => (
              <span key={item} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <CheckCircle2 className="h-3 w-3 text-primary/60" />
                {item}
              </span>
            ))}
          </div>
        </div>

        {/* ── Product Mockup ── */}
        <div className="relative mx-auto mt-14 max-w-[520px] animate-fade-in-up px-4">
          {/* Glow behind card */}
          <div className="pointer-events-none absolute -inset-8 rounded-3xl bg-[radial-gradient(ellipse_70%_50%_at_50%_50%,rgba(201,168,76,0.06),transparent)]" />

          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#121f33] shadow-2xl shadow-black/60">

            {/* Window chrome bar */}
            <div className="flex items-center justify-between border-b border-white/8 bg-white/[0.02] px-5 py-2.5">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
                  <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
                </div>
                <span className="ml-2 text-[10px] font-medium text-muted-foreground/60">
                  WPO Translations · Dashboard
                </span>
              </div>
              <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {t('dashboard.completed')}
              </span>
            </div>

            {/* Document info row */}
            <div className="flex items-center justify-between border-b border-white/6 px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-md border border-white/8 bg-primary/8">
                  <FileText className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs font-medium text-foreground">passport_ru.pdf</p>
                  <p className="text-[10px] text-muted-foreground">2.1 MB · 4 pages</p>
                </div>
              </div>
              <span className="text-[10px] text-muted-foreground/60">
                {t('documents.passport')}
              </span>
            </div>

            {/* Pipeline steps */}
            <div className="border-b border-white/6 px-5 py-4">
              <div className="flex items-center gap-1.5">
                {[
                  { label: 'OCR Extract',  done: true },
                  { label: 'AI Translate', done: true },
                  { label: 'PDF Generate', done: true },
                ].map((step, i) => (
                  <div key={step.label} className="flex flex-1 items-center gap-1.5">
                    <div className={`flex-1 rounded-sm px-2 py-1.5 text-center text-[10px] font-medium transition-colors
                      ${step.done
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-white/[0.04] text-muted-foreground/50'
                      }`}
                    >
                      {step.done && <span className="mr-1">✓</span>}
                      {step.label}
                    </div>
                    {i < 2 && (
                      <ArrowRight className="h-3 w-3 shrink-0 text-white/15" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Language pair */}
            <div className="flex items-center gap-3 border-b border-white/6 px-5 py-3.5">
              <div className="flex items-center gap-1.5 rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-1">
                <span className="text-sm">🇷🇺</span>
                <span className="text-[10px] font-medium text-foreground">Russian</span>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-primary/40" />
              <div className="flex items-center gap-1.5 rounded-md border border-white/8 bg-white/[0.03] px-2.5 py-1">
                <span className="text-sm">🇬🇧</span>
                <span className="text-[10px] font-medium text-foreground">English</span>
              </div>
              <div className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Zap className="h-3 w-3 text-primary/60" />
                3 min 42 sec
              </div>
            </div>

            {/* Result + Download */}
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-xs font-semibold text-foreground">{t('hero.translationReady')}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{t('hero.mockupSub')}</p>
              </div>
              <button className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-gold-dark">
                <Download className="h-3 w-3" />
                {t('hero.downloadPdf')}
              </button>
            </div>

          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────
          STAT STRIP
      ───────────────────────────────────────── */}
      <div className="border-y border-white/[0.07] bg-white/[0.015] px-4 py-5">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-5 sm:flex-row sm:justify-center sm:divide-x sm:divide-white/[0.07] sm:gap-0">
          {[
            { val: t('stats.documentCount'), label: t('stats.documentsLabel') },
            { val: t('stats.countriesCount'), label: t('stats.countriesLabel') },
            { val: t('stats.rating'),        label: t('stats.ratingLabel') },
          ].map(({ val, label }) => (
            <div key={label} className="px-10 text-center">
              <p className="text-2xl font-extrabold tracking-[-0.02em] text-primary">{val}</p>
              <p className="mt-0.5 text-[11px] font-medium text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ─────────────────────────────────────────
          PAIN SECTION
      ───────────────────────────────────────── */}
      <section className="border-b border-white/[0.07] bg-card px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/70">
              {t('pain.label')}
            </p>
            <h2 className="mx-auto max-w-2xl text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem]">
              {t('pain.title')}
            </h2>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PAIN_ITEMS.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-background/50 p-5 transition-all duration-200 hover:border-white/15 hover:bg-background/80"
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent" />
                <div className="relative">
                  <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/8 ring-1 ring-destructive/15">
                    <Icon className="h-4 w-4 text-destructive/70" />
                  </div>
                  <h3 className="mb-1.5 text-sm font-semibold text-foreground">{title}</h3>
                  <p className="text-[13px] leading-relaxed text-muted-foreground/80">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Solution bridge */}
          <div className="mt-10 flex items-center justify-center gap-3">
            <div className="h-px flex-1 bg-gradient-to-r from-transparent to-white/[0.06]" />
            <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-4 py-1.5 text-xs font-medium text-primary">
              <Zap className="h-3 w-3" />
              WPO {t('pain.item2Title') ? 'solves this' : ''}
            </div>
            <div className="h-px flex-1 bg-gradient-to-l from-transparent to-white/[0.06]" />
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────
          HOW IT WORKS — 4-step workflow
      ───────────────────────────────────────── */}
      <section id="how-it-works" className="px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-14 text-center">
            <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/70">
              {t('howItWorks.label')}
            </p>
            <h2 className="text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem]">
              {t('howItWorks.title')}
            </h2>
          </div>

          {/* Steps as a connected flow */}
          <div className="relative">
            {/* Connector line desktop */}
            <div className="absolute left-[12.5%] right-[12.5%] top-[28px] hidden h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent lg:block" />

            <div className="grid gap-6 lg:grid-cols-4">
              {[
                {
                  n: '01',
                  icon: Upload,
                  title: t('howItWorks.step1Title'),
                  desc: t('howItWorks.step1Desc'),
                },
                {
                  n: '02',
                  icon: FileCheck,
                  title: t('howItWorks.step2Title'),
                  desc: t('howItWorks.step2Desc'),
                },
                {
                  n: '03',
                  icon: CreditCard,
                  title: t('pricing.payg'),
                  desc: t('pricing.allPricesNote'),
                },
                {
                  n: '04',
                  icon: Download,
                  title: t('howItWorks.step3Title'),
                  desc: t('howItWorks.step3Desc'),
                },
              ].map((step, i) => (
                <div key={step.n} className="relative flex flex-col items-center text-center lg:items-start lg:text-left">
                  {/* Arrow between steps on small screens */}
                  {i < 3 && (
                    <div className="my-3 flex w-full justify-center lg:hidden">
                      <ArrowRight className="h-4 w-4 rotate-90 text-white/15 lg:rotate-0" />
                    </div>
                  )}

                  {/* Step icon + number */}
                  <div className="relative mb-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-xl border border-white/10 bg-card shadow-lg">
                      <step.icon className="h-5 w-5 text-primary" />
                    </div>
                    <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                      {step.n.slice(-1)}
                    </span>
                  </div>

                  <h3 className="mb-1.5 text-sm font-semibold text-foreground">{step.title}</h3>
                  <p className="max-w-[220px] text-[13px] leading-relaxed text-muted-foreground">{step.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────
          DOCUMENT TYPES — categorized
      ───────────────────────────────────────── */}
      <section id="documents" className="border-y border-white/[0.07] bg-card px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/70">
              {t('documents.label')}
            </p>
            <h2 className="text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem]">
              {t('documents.title')}
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">{t('documents.subtitle')}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DOC_CATEGORIES.map(({ label, items }) => (
              <div
                key={label}
                className="overflow-hidden rounded-xl border border-white/[0.07] bg-background/60 transition-all duration-200 hover:border-white/[0.14]"
              >
                {/* Category header */}
                <div className="border-b border-white/[0.06] px-4 py-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-primary/60">{label}</p>
                </div>
                {/* Items */}
                <div className="p-2">
                  {items.map(({ icon: Icon, label: docLabel }) => (
                    <div
                      key={docLabel}
                      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/8">
                        <Icon className="h-3.5 w-3.5 text-primary/70" />
                      </div>
                      <span className="text-[13px] font-medium text-foreground/85">{docLabel}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────
          USE CASES
      ───────────────────────────────────────── */}
      <section className="px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/70">
              {t('useCases.label')}
            </p>
            <h2 className="text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem]">
              {t('useCases.title')}
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {USE_CASES.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-card p-5 transition-all duration-200 hover:border-primary/25 hover:shadow-[0_0_24px_rgba(201,168,76,0.06)]"
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.025] to-transparent" />
                <div className="relative">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-white/[0.07] bg-background/60">
                    <Icon className="h-4.5 w-4.5 h-[18px] w-[18px] text-primary/70" />
                  </div>
                  <h3 className="mb-1.5 text-sm font-semibold text-foreground">{title}</h3>
                  <p className="text-[13px] leading-relaxed text-muted-foreground/80">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────
          SECURITY SECTION
      ───────────────────────────────────────── */}
      <section className="border-y border-white/[0.07] bg-card px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/70">
              {t('security.label')}
            </p>
            <h2 className="text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem]">
              {t('security.title')}
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
              {t('security.subtitle')}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SECURITY_ITEMS.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="relative overflow-hidden rounded-xl border border-white/[0.07] bg-background/50 p-5 transition-all duration-200 hover:border-white/[0.14]"
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent" />
                <div className="relative">
                  <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.07] bg-card">
                    <Icon className="h-4 w-4 text-primary/70" />
                  </div>
                  <h3 className="mb-1.5 text-[13px] font-semibold text-foreground">{title}</h3>
                  <p className="text-[12px] leading-relaxed text-muted-foreground/80">{desc}</p>
                </div>
              </div>
            ))}
          </div>

        </div>
      </section>

      {/* ─────────────────────────────────────────
          WHY WPO — trust features
      ───────────────────────────────────────── */}
      <section className="px-4 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/70">
              {t('trust.label')}
            </p>
            <h2 className="text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem]">
              {t('trust.title')}
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_ITEMS.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="group relative overflow-hidden rounded-xl border border-white/[0.07] bg-card p-5 transition-all duration-200 hover:border-white/15 hover:shadow-[0_0_20px_rgba(0,0,0,0.2)]"
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.025] to-transparent" />
                <div className="relative">
                  <div className="mb-3.5 flex h-9 w-9 items-center justify-center rounded-lg bg-primary/8 ring-1 ring-primary/15">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="mb-1.5 text-sm font-semibold text-foreground">{title}</h3>
                  <p className="text-[13px] leading-relaxed text-muted-foreground/80">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────
          PRICING
      ───────────────────────────────────────── */}
      <section className="border-y border-white/[0.07] bg-card px-4 py-20">
        <div className="mx-auto max-w-[860px]">
          <div className="mb-14 text-center">
            <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/70">
              {t('pricing.label')}
            </p>
            <h2 className="text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem]">
              {t('pricing.title')}
            </h2>
            <p className="mt-3 text-sm text-muted-foreground">{t('pricing.subtitle')}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {/* PAY AS YOU GO */}
            <div className="flex flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-background/60">
              <div className="border-b border-white/[0.06] px-6 py-5">
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">
                  {t('pricing.payg')}
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold tracking-[-0.02em] text-foreground">$4.39</span>
                  <span className="text-xs text-muted-foreground">{t('pricing.perDoc')}</span>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">{t('pricing.paygNote')}</p>
              </div>
              <div className="flex flex-1 flex-col p-6">
                <ul className="mb-6 flex-1 space-y-2">
                  {[t('pricing.feature1'), t('pricing.feature2'), t('pricing.feature3'), t('pricing.feature4')].map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px] text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/auth/signup"
                  className="inline-flex w-full items-center justify-center rounded-lg border border-white/15 bg-white/[0.04] py-2.5 text-sm font-medium text-foreground/80 transition-all duration-150 hover:border-white/30 hover:bg-white/[0.07] hover:text-foreground"
                >
                  {t('pricing.startTranslating')}
                </Link>
              </div>
            </div>

            {/* BASIC — highlighted */}
            <div className="relative flex flex-col overflow-hidden rounded-xl border border-primary/35 bg-background/70 shadow-[0_0_40px_rgba(201,168,76,0.07)]">
              <div className="absolute -top-px left-1/2 h-px w-24 -translate-x-1/2 bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="rounded-full bg-primary px-3 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
                  {t('pricing.mostPopular')}
                </span>
              </div>

              <div className="border-b border-primary/15 px-6 py-5">
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
                  {t('pricing.basic')}
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold tracking-[-0.02em] text-foreground">$9.99</span>
                  <span className="text-xs text-muted-foreground">{t('pricing.perMonth')}</span>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">10 {t('pricing.docs')}</p>
              </div>
              <div className="flex flex-1 flex-col p-6">
                <ul className="mb-6 flex-1 space-y-2">
                  {[`10 ${t('pricing.docs')}`, t('pricing.allDocTypes'), t('pricing.aiTranslation'), t('pricing.cleanPdf'), t('pricing.dayAccess')].map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px] text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/auth/signup"
                  className="inline-flex w-full items-center justify-center rounded-lg bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-all duration-150 hover:bg-gold-dark hover:brightness-110"
                >
                  {t('pricing.subscribe')}
                </Link>
              </div>
            </div>

            {/* PRO */}
            <div className="flex flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-background/60">
              <div className="border-b border-white/[0.06] px-6 py-5">
                <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/70">
                  {t('pricing.pro')}
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold tracking-[-0.02em] text-foreground">$24.99</span>
                  <span className="text-xs text-muted-foreground">{t('pricing.perMonth')}</span>
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">40 {t('pricing.docs')} · {t('pricing.proDesc')}</p>
              </div>
              <div className="flex flex-1 flex-col p-6">
                <ul className="mb-6 flex-1 space-y-2">
                  {[`40 ${t('pricing.docs')}`, t('pricing.allDocTypes'), t('pricing.aiTranslation'), t('pricing.cleanPdf'), t('pricing.priorityProcessing')].map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px] text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/60" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/auth/signup"
                  className="inline-flex w-full items-center justify-center rounded-lg border border-white/15 bg-white/[0.04] py-2.5 text-sm font-medium text-foreground/80 transition-all duration-150 hover:border-white/30 hover:bg-white/[0.07] hover:text-foreground"
                >
                  {t('pricing.subscribe')}
                </Link>
              </div>
            </div>
          </div>

          <p className="mt-5 text-center text-[11px] text-muted-foreground/60">
            {t('pricing.allPricesNote')}
          </p>
        </div>
      </section>

      {/* ─────────────────────────────────────────
          FAQ
      ───────────────────────────────────────── */}
      <section className="px-4 py-20">
        <div className="mx-auto max-w-2xl">
          <div className="mb-12 text-center">
            <p className="mb-2.5 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/70">
              {t('faq.label')}
            </p>
            <h2 className="text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem]">
              {t('faq.title')}
            </h2>
          </div>

          <div className="space-y-1.5">
            {FAQ.map(({ q, a }) => (
              <details
                key={q}
                className="group overflow-hidden rounded-xl border border-white/[0.07] bg-card transition-all duration-200 open:border-white/[0.12] open:bg-card/80"
              >
                <summary className="flex cursor-pointer list-none select-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium text-foreground/90 transition-colors hover:text-foreground">
                  {q}
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground/60 transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <div className="border-t border-white/[0.06] px-5 pb-5 pt-3">
                  <p className="text-[13px] leading-relaxed text-muted-foreground/90">{a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────
          FINAL CTA
      ───────────────────────────────────────── */}
      <section className="relative overflow-hidden border-t border-white/[0.07] px-4 py-28 text-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_70%_at_50%_50%,rgba(201,168,76,0.065),transparent)]" />
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-30" />

        <div className="relative mx-auto max-w-[520px]">
          <p className="mb-4 text-[10px] font-bold uppercase tracking-[0.15em] text-primary/60">
            {t('trust.label')}
          </p>
          <h2 className="mb-5 text-2xl font-bold tracking-[-0.025em] text-foreground sm:text-[1.85rem] lg:text-[2.2rem]">
            {t('cta.title')}
          </h2>
          <p className="mb-9 text-sm leading-relaxed text-muted-foreground sm:text-[0.95rem]">
            {t('cta.subtitle')}
          </p>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/auth/signup"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-all duration-150 hover:bg-gold-dark hover:brightness-110 hover:scale-[1.02]"
            >
              <Upload className="h-4 w-4" />
              {t('cta.button')}
            </Link>
          </div>

          <p className="mt-5 text-[11px] text-muted-foreground/60">
            {t('cta.noSub')}
          </p>

        </div>
      </section>
    </div>
  );
}
