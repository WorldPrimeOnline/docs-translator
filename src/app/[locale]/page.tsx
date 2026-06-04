import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  Upload, Download, IdCard, FileHeart, GraduationCap, Landmark,
  HeartPulse, Briefcase, Shield, Car, FileText, Zap, Lock,
  Clock, Globe, Server, Trash2, Eye, ChevronDown, CheckCircle2,
  FileCheck, Cpu, Plane, Building2, CreditCard, MapPin, ArrowRight, Plus,
} from 'lucide-react';

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();

  const DOC_CATEGORIES = [
    { label: 'Identity',    items: [{ icon: IdCard, label: t('documents.passport') }, { icon: Car, label: t('documents.driver') }] },
    { label: 'Financial',   items: [{ icon: Landmark, label: t('documents.bank') }, { icon: Briefcase, label: t('documents.employment') }] },
    { label: 'Education',   items: [{ icon: GraduationCap, label: t('documents.diploma') }, { icon: FileCheck, label: 'Transcript' }] },
    { label: 'Legal',       items: [{ icon: FileHeart, label: t('documents.birth') }, { icon: Shield, label: t('documents.police') }] },
    { label: 'Medical',     items: [{ icon: HeartPulse, label: t('documents.medical') }] },
    { label: 'Other',       items: [{ icon: FileText, label: t('documents.other') }] },
  ];

  const TRUST_ITEMS = [
    { icon: Zap,    title: t('trust.speed'),         desc: t('trust.speedDesc') },
    { icon: Lock,   title: t('trust.security'),      desc: t('trust.securityDesc') },
    { icon: Cpu,    title: t('trust.pillar2Title'),   desc: t('trust.pillar2Body') },
    { icon: CreditCard, title: t('trust.payment'),     desc: t('trust.paymentDesc') },
  ];

  const PAIN_ITEMS = [
    { icon: Clock,      title: t('pain.item1Title'), desc: t('pain.item1Desc') },
    { icon: FileText,   title: t('pain.item2Title'), desc: t('pain.item2Desc') },
    { icon: CreditCard, title: t('pain.item3Title'), desc: t('pain.item3Desc') },
    { icon: Globe,      title: t('pain.item4Title'), desc: t('pain.item4Desc') },
  ];

  const SECURITY_ITEMS = [
    { icon: Server, title: t('security.item1Title'), desc: t('security.item1Desc') },
    { icon: Trash2, title: t('security.item2Title'), desc: t('security.item2Desc') },
    { icon: Eye,    title: t('security.item3Title'), desc: t('security.item3Desc') },
    { icon: Shield, title: t('security.item4Title'), desc: t('security.item4Desc') },
  ];

  const USE_CASES = [
    { icon: Plane,        title: t('useCases.visa'),       desc: t('useCases.visaDesc') },
    { icon: GraduationCap,title: t('useCases.university'), desc: t('useCases.universityDesc') },
    { icon: Building2,    title: t('useCases.banking'),    desc: t('useCases.bankingDesc') },
    { icon: MapPin,       title: t('useCases.relocation'), desc: t('useCases.relocationDesc') },
  ];

  const faqRaw = t.raw('faq') as Record<string, string>;
  const FAQ: { q: string; a: string }[] = [];
  for (let i = 1; ; i++) {
    const q = faqRaw[`q${i}`];
    const a = faqRaw[`a${i}`];
    if (!q || !a) break;
    FAQ.push({ q, a });
  }

  return (
    <div className="bg-background">

      {/* ═══════════════════════════════════════════
          HERO  —  two-column on desktop
      ═══════════════════════════════════════════ */}
      <section className="relative overflow-hidden pt-14 pb-16 sm:pt-20 sm:pb-24 lg:pt-24 lg:pb-28">
        {/* Top glow */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_60%_at_60%_-10%,rgba(201,168,76,0.08),transparent)]" />
        {/* Bottom fade */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />

        <div className="relative mx-auto max-w-6xl px-4">
          {/* ── Two-column grid ── */}
          <div className="grid items-center gap-12 lg:grid-cols-[1fr_480px] lg:gap-16">

            {/* ── LEFT: Copy ── */}
            <div className="flex flex-col items-start">
              {/* Badge */}
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-1.5 text-[11px] font-medium tracking-wide text-muted-foreground backdrop-blur-sm">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                {t('hero.badge')}
              </div>

              {/* Headline — large */}
              <h1 className="mb-5 text-4xl font-extrabold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-5xl lg:text-6xl xl:text-[4.25rem]">
                {t('hero.title')}
                <br />
                <span className="text-primary">{t('hero.accentLine')}</span>
              </h1>

              {/* Subheadline */}
              <p className="mb-8 max-w-[480px] text-base leading-relaxed text-muted-foreground sm:text-[1.05rem]">
                {t('hero.subtitle')}
              </p>

              {/* CTAs */}
              <div className="flex flex-wrap gap-3">
                <Link
                  href="/auth/signup"
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-7 py-3 text-sm font-semibold text-primary-foreground transition-all duration-150 hover:bg-gold-dark hover:brightness-110 hover:scale-[1.02]"
                >
                  <Upload className="h-4 w-4" />
                  {t('hero.cta')}
                </Link>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.04] px-7 py-3 text-sm font-medium text-foreground/80 transition-all duration-150 hover:border-white/30 hover:bg-white/[0.07] hover:text-foreground"
                >
                  {t('hero.seeHowItWorks')}
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </a>
              </div>

              {/* Trust signals */}
              <div className="mt-7 flex flex-wrap gap-x-6 gap-y-2">
                {[t('trust.speed'), t('trust.security'), t('trust.payment')].map((item) => (
                  <span key={item} className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/70">
                    <CheckCircle2 className="h-3 w-3 text-primary/50 shrink-0" />
                    {item}
                  </span>
                ))}
              </div>
            </div>

            {/* ── RIGHT: Product mockup ── */}
            <div className="relative w-full animate-fade-in-up lg:mt-0">
              {/* Glow halo */}
              <div className="pointer-events-none absolute -inset-10 bg-[radial-gradient(ellipse_70%_60%_at_50%_50%,rgba(201,168,76,0.07),transparent)]" />

              <div className="relative overflow-hidden rounded-2xl border border-white/[0.12] bg-[#0e1b2e] shadow-[0_32px_80px_rgba(0,0,0,0.6)]">
                {/* Titlebar */}
                <div className="flex items-center gap-3 border-b border-white/[0.07] bg-[#0c1828] px-5 py-3">
                  <div className="flex gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-white/[0.08]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/[0.08]" />
                    <span className="h-2.5 w-2.5 rounded-full bg-white/[0.08]" />
                  </div>
                  <span className="text-[11px] font-medium text-white/25">wpotranslations.org — Dashboard</span>
                  <span className="ml-auto flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    {t('dashboard.completed')}
                  </span>
                </div>

                {/* File row */}
                <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-primary/[0.08]">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-[13px] font-semibold text-foreground">passport_ru.pdf</p>
                    <p className="text-[11px] text-muted-foreground">2.1 MB · {t('documents.passport')}</p>
                  </div>
                </div>

                {/* Pipeline */}
                <div className="border-b border-white/[0.06] px-5 py-4">
                  <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Processing pipeline</p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { label: 'OCR Extract', done: true },
                      { label: 'AI Translate', done: true },
                      { label: 'PDF Generate', done: true },
                    ].map((s) => (
                      <div key={s.label} className="flex items-center justify-center gap-1 rounded-md bg-emerald-500/[0.08] px-2 py-2 text-[10px] font-medium text-emerald-400">
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        {s.label}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Language pair */}
                <div className="flex items-center gap-3 border-b border-white/[0.06] px-5 py-3.5">
                  <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-1.5">
                    <span className="text-base">🇷🇺</span>
                    <span className="text-[11px] font-medium text-foreground/80">Russian</span>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-primary/40 shrink-0" />
                  <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-1.5">
                    <span className="text-base">🇬🇧</span>
                    <span className="text-[11px] font-medium text-foreground/80">English</span>
                  </div>
                  <div className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                    <Zap className="h-3 w-3 text-primary/60" />
                    3m 42s
                  </div>
                </div>

                {/* Result row */}
                <div className="flex items-center justify-between bg-primary/[0.04] px-5 py-4">
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">{t('hero.translationReady')}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{t('hero.mockupSub')}</p>
                  </div>
                  <div className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[11px] font-semibold text-primary-foreground">
                    <Download className="h-3.5 w-3.5" />
                    {t('hero.downloadPdf')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          PAIN  —  why bureaus don't work
      ═══════════════════════════════════════════ */}
      <section className="px-4 py-20 lg:py-28">
        <div className="mx-auto max-w-5xl">
          {/* Header */}
          <div className="mb-14 max-w-2xl">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-primary/60">
              {t('pain.label')}
            </p>
            <h2 className="text-3xl font-bold tracking-[-0.025em] text-foreground sm:text-4xl lg:text-[2.5rem]">
              {t('pain.title')}
            </h2>
          </div>

          {/* 4 pain cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PAIN_ITEMS.map(({ icon: Icon, title, desc }, i) => (
              <div
                key={title}
                className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-card p-6 transition-all duration-200 hover:border-white/[0.14] hover:-translate-y-0.5"
              >
                {/* Top accent */}
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.07] to-transparent" />
                {/* Index */}
                <span className="absolute right-4 top-4 text-[11px] font-bold text-white/[0.06]">
                  0{i + 1}
                </span>
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-destructive/[0.08] ring-1 ring-destructive/[0.12]">
                  <Icon className="h-4.5 w-4.5 h-[18px] w-[18px] text-destructive/60" />
                </div>
                <h3 className="mb-2 text-[15px] font-semibold leading-snug text-foreground">{title}</h3>
                <p className="text-[13px] leading-relaxed text-muted-foreground/80">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          HOW IT WORKS  —  4-step connected flow
      ═══════════════════════════════════════════ */}
      <section id="how-it-works" className="border-y border-white/[0.07] bg-card px-4 py-20 lg:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="mb-14 text-center">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-primary/60">
              {t('howItWorks.label')}
            </p>
            <h2 className="text-3xl font-bold tracking-[-0.025em] text-foreground sm:text-4xl">
              {t('howItWorks.title')}
            </h2>
          </div>

          {/* Steps */}
          <div className="relative grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {/* Connector line desktop */}
            <div className="absolute left-[calc(12.5%+20px)] right-[calc(12.5%+20px)] top-[28px] hidden h-px lg:block"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(201,168,76,0.2) 20%, rgba(201,168,76,0.2) 80%, transparent)' }}
            />

            {[
              { n: '01', icon: Upload,     title: t('howItWorks.step1Title'), desc: t('howItWorks.step1Desc') },
              { n: '02', icon: FileCheck,  title: t('howItWorks.step2Title'), desc: t('howItWorks.step2Desc') },
              { n: '03', icon: CreditCard, title: t('pricing.payg'),          desc: t('pricing.allPricesNote') },
              { n: '04', icon: Download,   title: t('howItWorks.step3Title'), desc: t('howItWorks.step3Desc') },
            ].map((step) => (
              <div key={step.n} className="flex flex-col items-center text-center">
                <div className="relative mb-5">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.1] bg-background shadow-lg">
                    <step.icon className="h-5 w-5 text-primary" />
                  </div>
                  <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shadow">
                    {step.n.slice(-1)}
                  </span>
                </div>
                <h3 className="mb-2 text-[15px] font-semibold text-foreground">{step.title}</h3>
                <p className="max-w-[180px] text-[13px] leading-relaxed text-muted-foreground">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          DOCUMENTS  —  categorized
      ═══════════════════════════════════════════ */}
      <section id="documents" className="px-4 py-20 lg:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="mb-14 text-center">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-primary/60">
              {t('documents.label')}
            </p>
            <h2 className="text-3xl font-bold tracking-[-0.025em] text-foreground sm:text-4xl">
              {t('documents.title')}
            </h2>
            <p className="mt-3 text-[15px] text-muted-foreground">{t('documents.subtitle')}</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {DOC_CATEGORIES.map(({ label, items }) => (
              <div
                key={label}
                className="overflow-hidden rounded-2xl border border-white/[0.07] bg-card transition-all duration-200 hover:border-white/[0.13]"
              >
                <div className="border-b border-white/[0.06] bg-white/[0.02] px-5 py-3">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/60">{label}</p>
                </div>
                <div className="p-2">
                  {items.map(({ icon: Icon, label: docLabel }) => (
                    <div
                      key={docLabel}
                      className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-white/[0.04]"
                    >
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08]">
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

      {/* ═══════════════════════════════════════════
          USE CASES
      ═══════════════════════════════════════════ */}
      <section className="border-y border-white/[0.07] bg-card px-4 py-20 lg:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="mb-14 text-center">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-primary/60">
              {t('useCases.label')}
            </p>
            <h2 className="text-3xl font-bold tracking-[-0.025em] text-foreground sm:text-4xl">
              {t('useCases.title')}
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {USE_CASES.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-background/60 p-6 transition-all duration-200 hover:border-primary/[0.2] hover:bg-background/90 hover:-translate-y-0.5"
              >
                <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-white/[0.025] to-transparent" />
                <div className="relative">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.07] bg-card">
                    <Icon className="h-[18px] w-[18px] text-primary/70" />
                  </div>
                  <h3 className="mb-2 text-[15px] font-semibold text-foreground">{title}</h3>
                  <p className="text-[13px] leading-relaxed text-muted-foreground/80">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          SECURITY
      ═══════════════════════════════════════════ */}
      <section className="px-4 py-20 lg:py-28">
        <div className="mx-auto max-w-5xl">
          {/* Header — left-aligned for variety */}
          <div className="mb-14 grid gap-6 lg:grid-cols-2 lg:items-end">
            <div>
              <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-primary/60">
                {t('security.label')}
              </p>
              <h2 className="text-3xl font-bold tracking-[-0.025em] text-foreground sm:text-4xl">
                {t('security.title')}
              </h2>
            </div>
            <p className="text-[15px] leading-relaxed text-muted-foreground lg:text-right">
              {t('security.subtitle')}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SECURITY_ITEMS.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-card p-6 transition-all duration-200 hover:border-white/[0.14]"
              >
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
                <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-background">
                  <Icon className="h-4 w-4 text-primary/70" />
                </div>
                <h3 className="mb-2 text-[13px] font-semibold text-foreground">{title}</h3>
                <p className="text-[12px] leading-relaxed text-muted-foreground/80">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          WHY WPO
      ═══════════════════════════════════════════ */}
      <section className="border-y border-white/[0.07] bg-card px-4 py-20 lg:py-28">
        <div className="mx-auto max-w-5xl">
          <div className="mb-14 text-center">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-primary/60">
              {t('trust.label')}
            </p>
            <h2 className="text-3xl font-bold tracking-[-0.025em] text-foreground sm:text-4xl">
              {t('trust.title')}
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_ITEMS.map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="group relative overflow-hidden rounded-2xl border border-white/[0.07] bg-background/60 p-6 transition-all duration-200 hover:border-white/[0.14] hover:-translate-y-0.5"
              >
                <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-white/[0.025] to-transparent" />
                <div className="relative">
                  <div className="mb-4 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/[0.09] ring-1 ring-primary/[0.12]">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <h3 className="mb-2 text-[15px] font-semibold text-foreground">{title}</h3>
                  <p className="text-[13px] leading-relaxed text-muted-foreground/80">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          PRICING
      ═══════════════════════════════════════════ */}
      <section className="px-4 py-20 lg:py-28">
        <div className="mx-auto max-w-[900px]">
          <div className="mb-14 text-center">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-primary/60">
              {t('pricing.label')}
            </p>
            <h2 className="text-3xl font-bold tracking-[-0.025em] text-foreground sm:text-4xl">
              {t('pricing.title')}
            </h2>
            <p className="mt-3 text-[15px] text-muted-foreground">{t('pricing.subtitle')}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {/* PAYG */}
            <div className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-card">
              <div className="border-b border-white/[0.06] px-7 py-6">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
                  {t('pricing.payg')}
                </p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[2rem] font-extrabold tracking-tight text-foreground">2 290 ₸</span>
                  <span className="text-[13px] text-muted-foreground">{t('pricing.perDoc')}</span>
                </div>
                <p className="mt-2 text-[12px] text-muted-foreground">{t('pricing.paygNote')}</p>
              </div>
              <div className="flex flex-1 flex-col px-7 py-6">
                <ul className="mb-7 flex-1 space-y-2.5">
                  {[t('pricing.feature1'), t('pricing.feature2'), t('pricing.feature3'), t('pricing.feature4')].map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[13px] text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/35" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/auth/signup" className="inline-flex w-full items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] py-3 text-sm font-semibold text-foreground/80 transition-all hover:border-white/25 hover:bg-white/[0.08] hover:text-foreground">
                  {t('pricing.startTranslating')}
                </Link>
              </div>
            </div>

            {/* BASIC — highlighted */}
            <div className="relative flex flex-col overflow-hidden rounded-2xl border border-primary/40 bg-card shadow-[0_0_60px_rgba(201,168,76,0.08)]">
              {/* Top glow line */}
              <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-primary/70 to-transparent" />

              {/* Popular badge — inline so overflow-hidden doesn't clip it */}
              <div className="flex justify-center pt-5">
                <span className="rounded-full bg-primary px-4 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-foreground shadow-lg">
                  {t('pricing.mostPopular')}
                </span>
              </div>

              <div className="border-b border-primary/[0.12] px-7 pb-6 pt-3">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-primary">
                  {t('pricing.basic')}
                </p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[2rem] font-extrabold tracking-tight text-foreground">4 990 ₸</span>
                  <span className="text-[13px] text-muted-foreground">{t('pricing.perMonth')}</span>
                </div>
                <p className="mt-2 text-[12px] text-muted-foreground">10 {t('pricing.docs')}</p>
              </div>
              <div className="flex flex-1 flex-col px-7 py-6">
                <ul className="mb-7 flex-1 space-y-2.5">
                  {[`10 ${t('pricing.docs')}`, t('pricing.allDocTypes'), t('pricing.aiTranslation'), t('pricing.cleanPdf'), t('pricing.dayAccess')].map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[13px] text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/auth/signup" className="inline-flex w-full items-center justify-center rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground transition-all hover:bg-gold-dark hover:brightness-110">
                  {t('pricing.subscribe')}
                </Link>
              </div>
            </div>

            {/* PRO */}
            <div className="flex flex-col overflow-hidden rounded-2xl border border-white/[0.08] bg-card">
              <div className="border-b border-white/[0.06] px-7 py-6">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
                  {t('pricing.pro')}
                </p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[2rem] font-extrabold tracking-tight text-foreground">12 990 ₸</span>
                  <span className="text-[13px] text-muted-foreground">{t('pricing.perMonth')}</span>
                </div>
                <p className="mt-2 text-[12px] text-muted-foreground">40 {t('pricing.docs')}</p>
              </div>
              <div className="flex flex-1 flex-col px-7 py-6">
                <ul className="mb-7 flex-1 space-y-2.5">
                  {[`40 ${t('pricing.docs')}`, t('pricing.allDocTypes'), t('pricing.aiTranslation'), t('pricing.cleanPdf'), t('pricing.priorityProcessing')].map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-[13px] text-muted-foreground">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/60" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link href="/auth/signup" className="inline-flex w-full items-center justify-center rounded-xl border border-white/[0.12] bg-white/[0.04] py-3 text-sm font-semibold text-foreground/80 transition-all hover:border-white/25 hover:bg-white/[0.08] hover:text-foreground">
                  {t('pricing.subscribe')}
                </Link>
              </div>
            </div>
          </div>

          <p className="mt-6 text-center text-[11px] text-muted-foreground/50">
            {t('pricing.allPricesNote')}
          </p>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          FAQ
      ═══════════════════════════════════════════ */}
      <section className="border-y border-white/[0.07] bg-card px-4 py-20 lg:py-28">
        <div className="mx-auto max-w-[680px]">
          <div className="mb-14 text-center">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.14em] text-primary/60">
              {t('faq.label')}
            </p>
            <h2 className="text-3xl font-bold tracking-[-0.025em] text-foreground sm:text-4xl">
              {t('faq.title')}
            </h2>
          </div>

          <div className="space-y-2">
            {FAQ.map(({ q, a }, i) => (
              <details
                key={i}
                className="group overflow-hidden rounded-2xl border border-white/[0.07] bg-background/60 transition-all open:border-white/[0.13] open:bg-background/90"
              >
                <summary className="flex cursor-pointer list-none select-none items-start justify-between gap-4 px-6 py-5 text-[15px] font-medium text-foreground/90 transition-colors hover:text-foreground">
                  <span className="leading-snug">{q}</span>
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/[0.06] text-muted-foreground/60 transition-all group-open:bg-primary/10 group-open:text-primary">
                    <Plus className="h-3 w-3 transition-transform group-open:rotate-45" />
                  </span>
                </summary>
                <div className="border-t border-white/[0.06] px-6 pb-5 pt-4">
                  <p className="text-[14px] leading-relaxed text-muted-foreground/85">{a}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════
          FINAL CTA
      ═══════════════════════════════════════════ */}
      <section className="relative overflow-hidden px-4 py-28 text-center lg:py-36">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_50%_50%,rgba(201,168,76,0.07),transparent)]" />

        <div className="relative mx-auto max-w-[560px]">
          <p className="mb-5 text-[11px] font-bold uppercase tracking-[0.14em] text-primary/60">
            {t('trust.label')}
          </p>
          <h2 className="mb-5 text-3xl font-bold tracking-[-0.025em] text-foreground sm:text-4xl lg:text-[2.5rem]">
            {t('cta.title')}
          </h2>
          <p className="mb-10 text-[15px] leading-relaxed text-muted-foreground">
            {t('cta.subtitle')}
          </p>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/auth/signup"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-8 py-3.5 text-sm font-bold text-primary-foreground transition-all hover:bg-gold-dark hover:brightness-110 hover:scale-[1.02]"
            >
              <Upload className="h-4 w-4" />
              {t('cta.button')}
            </Link>
            <a href="#how-it-works" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
              {t('hero.seeHowItWorks')} →
            </a>
          </div>

          <p className="mt-6 text-[11px] text-muted-foreground/50">
            {t('cta.noSub')}
          </p>
        </div>
      </section>
    </div>
  );
}
