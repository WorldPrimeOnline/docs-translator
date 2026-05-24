import Link from 'next/link';
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
  AlertCircle,
  Coins,
  ChevronDown,
} from 'lucide-react';

const HOW_IT_WORKS = [
  {
    icon: Upload,
    title: 'Upload your PDF',
    desc: 'Select any scanned document — passport, diploma, bank statement, or more. Up to 50 pages, 25 MB.',
    step: '01',
  },
  {
    icon: Cpu,
    title: 'AI translates every word',
    desc: 'Our AI reads the document, preserves names and numbers, and produces an accurate translation in minutes.',
    step: '02',
  },
  {
    icon: Download,
    title: 'Download your translation',
    desc: 'Receive a clean, formatted PDF with a disclaimer on every page. Ready to share or attach to your application.',
    step: '03',
  },
];

const DOC_TYPES = [
  { icon: IdCard, label: 'Passport & ID Card' },
  { icon: FileHeart, label: 'Birth / Marriage Certificate' },
  { icon: GraduationCap, label: 'Diploma & Transcript' },
  { icon: Landmark, label: 'Bank Statement' },
  { icon: HeartPulse, label: 'Medical Record' },
  { icon: Briefcase, label: 'Employment Contract' },
  { icon: Shield, label: 'Police Clearance' },
  { icon: Car, label: "Driver's License" },
  { icon: FileText, label: 'Any Other Document' },
];

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

const TRUST = [
  {
    icon: Zap,
    title: 'Ready in 2–5 minutes',
    desc: 'Most documents are translated in under 5 minutes. Traditional bureaus take days.',
  },
  {
    icon: BadgeDollarSign,
    title: 'Up to 3× cheaper',
    desc: 'From $4.39 per document vs $25–40 at a translation bureau. Same result, fraction of the price.',
  },
  {
    icon: Coins,
    title: 'TON blockchain payments',
    desc: 'Pay securely with TON cryptocurrency. No bank card required. Instant, trustless, borderless.',
  },
  {
    icon: Lock,
    title: 'Auto-deleted after 30 days',
    desc: 'Your documents are stored securely and permanently deleted after 30 days. We never share them.',
  },
  {
    icon: AlertCircle,
    title: 'Informational translation',
    desc: 'Our translations are for informational use. Not certified or notarized. Check with your institution.',
  },
];

const FAQ = [
  {
    q: 'Is this translation accepted by consulates or universities?',
    a: 'This is an informational translation, not a certified or notarized one. For official certified translations required by government bodies, please check with the specific institution. Many institutions accept informational translations for internal review purposes.',
  },
  {
    q: 'How long does it take?',
    a: 'Most documents (1–5 pages) are translated in 2–5 minutes. Longer documents may take up to 10–15 minutes.',
  },
  {
    q: 'Which languages are supported?',
    a: 'We support 10+ languages including English, Russian, Thai, Chinese, Korean, Japanese, German, French, Spanish, and Arabic. Our AI handles additional languages too — contact us if yours is not listed.',
  },
  {
    q: 'Is my document kept private?',
    a: 'Yes. Your files are encrypted in storage and automatically deleted after 30 days. We never share your documents with third parties.',
  },
  {
    q: 'What file formats are accepted?',
    a: 'We accept PDF files only, up to 25 MB in size and 50 pages in length. Both scanned and digital PDFs are supported.',
  },
  {
    q: 'How do I pay?',
    a: 'We accept TON cryptocurrency. Use any TON wallet — Tonkeeper, MyTonWallet, or any other. The payment window is 30 minutes after you submit your document.',
  },
];

export default function Home() {
  return (
    <div className="bg-background">
      {/* HERO */}
      <section className="relative overflow-hidden bg-grid px-4 pb-28 pt-20 text-center sm:pb-36 sm:pt-28">
        {/* Gold radial glow from top */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_50%_at_50%_-10%,rgba(201,168,76,0.12),transparent)]" />
        {/* Darker gradient at bottom to blend into next section */}
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background to-transparent" />

        <div className="relative mx-auto max-w-3xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
            AI-powered · Instant results · 10+ languages
          </div>

          <h1 className="mb-6 text-5xl font-bold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
            Translate Any Document
            <br />
            <span className="text-primary">in Minutes</span>
          </h1>

          <p className="mx-auto mb-10 max-w-xl text-lg leading-relaxed text-muted-foreground">
            AI-powered translation for passports, diplomas, contracts, and bank statements.
            From <strong className="text-foreground">$4.39</strong> per document — 3× cheaper than translation bureaus.
          </p>

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/auth/signup"
              className="inline-flex items-center justify-center rounded-md bg-primary px-8 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
            >
              Start Translating
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center gap-1.5 rounded-md border border-white/15 bg-white/5 px-8 py-3 text-sm font-medium text-foreground transition-colors hover:bg-white/10"
            >
              See How It Works
              <ChevronDown className="h-4 w-4" />
            </a>
          </div>

          <p className="mt-8 text-xs text-muted-foreground">
            No subscription · Pay only when you translate · Results in 2–5 minutes
          </p>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="px-4 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
              The Process
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Three steps to your translation
            </h2>
          </div>

          <div className="relative grid gap-8 sm:grid-cols-3">
            {/* Connecting line on desktop */}
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
              What We Translate
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              All document types
            </h2>
            <p className="mt-3 text-muted-foreground">
              Used in immigration, education, banking, and legal contexts
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {DOC_TYPES.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-lg border border-white/8 bg-background/60 p-4 transition-colors hover:border-white/15 hover:bg-background/80"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
                  <Icon className="h-4 w-4 text-primary" />
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
              Language Pairs
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              10+ languages supported
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
        <div className="mx-auto max-w-3xl">
          <div className="mb-14 text-center">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
              Pricing
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Simple, transparent pricing
            </h2>
            <p className="mt-3 text-muted-foreground">
              No subscription. Pay only when you translate.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Passport / ID — highlighted */}
            <div className="relative rounded-lg border border-primary/40 bg-background/60 p-7 shadow-lg shadow-primary/5">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <span className="rounded-full bg-primary px-3 py-0.5 text-xs font-semibold text-primary-foreground">
                  Most popular
                </span>
              </div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-primary">
                Passport & ID
              </div>
              <div className="mb-5 flex items-end gap-1">
                <span className="text-4xl font-bold tracking-tight text-foreground">$4.39</span>
                <span className="mb-1 text-sm text-muted-foreground">per document</span>
              </div>
              <ul className="mb-7 space-y-2 text-sm text-muted-foreground">
                {[
                  'Passport, ID card, driver\'s license',
                  'AI translation by Claude Sonnet',
                  'Clean PDF with disclaimer',
                  'Delivery in 2–5 minutes',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 text-primary">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/signup"
                className="inline-flex w-full items-center justify-center rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
              >
                Start Translating
              </Link>
            </div>

            {/* All other documents */}
            <div className="rounded-lg border border-white/10 bg-background/60 p-7">
              <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                All Other Documents
              </div>
              <div className="mb-5 flex items-end gap-1">
                <span className="text-4xl font-bold tracking-tight text-foreground">$4.99</span>
                <span className="mb-1 text-sm text-muted-foreground">per document</span>
              </div>
              <ul className="mb-7 space-y-2 text-sm text-muted-foreground">
                {[
                  'Diplomas, contracts, bank statements',
                  'Medical records, certificates',
                  'AI translation by Claude Sonnet',
                  '10+ language pairs',
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <span className="mt-0.5 text-muted-foreground">✓</span>
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/auth/signup"
                className="inline-flex w-full items-center justify-center rounded-md border border-white/15 bg-white/5 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-white/10"
              >
                Start Translating
              </Link>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            All prices in USD · Paid via TON cryptocurrency · No bank card required
          </p>
        </div>
      </section>

      {/* WHY WPO */}
      <section className="px-4 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="mb-14 text-center">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
              Why WPO Translations
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Built for people navigating bureaucracy abroad
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {TRUST.slice(0, 3).map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="rounded-lg border border-white/10 bg-card p-6 transition-colors hover:border-white/15"
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <h3 className="mb-1.5 text-sm font-semibold text-foreground">{title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {TRUST.slice(3).map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="rounded-lg border border-white/10 bg-card p-6 transition-colors hover:border-white/15"
              >
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

      {/* FAQ */}
      <section className="border-y border-white/10 bg-card px-4 py-24">
        <div className="mx-auto max-w-2xl">
          <div className="mb-14 text-center">
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-primary">
              FAQ
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Frequently asked questions
            </h2>
          </div>

          <div className="space-y-2">
            {FAQ.map(({ q, a }) => (
              <details
                key={q}
                className="group rounded-lg border border-white/10 bg-background/60 px-5 py-4"
              >
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
      <section className="relative overflow-hidden px-4 py-32 text-center">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgba(201,168,76,0.07),transparent)]" />
        <div className="relative mx-auto max-w-xl">
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:text-5xl">
            Ready to translate your document?
          </h2>
          <p className="mb-10 text-muted-foreground">
            Upload your PDF and get a translated version in minutes. From $4.39.
          </p>
          <Link
            href="/auth/signup"
            className="inline-flex items-center justify-center rounded-md bg-primary px-10 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
          >
            Get Started
          </Link>
          <p className="mt-4 text-xs text-muted-foreground">
            No subscription · Pay only when you translate
          </p>
        </div>
      </section>
    </div>
  );
}
