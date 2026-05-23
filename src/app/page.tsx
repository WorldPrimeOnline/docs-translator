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
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const HOW_IT_WORKS = [
  {
    icon: Upload,
    title: 'Upload your PDF',
    desc: 'Select any scanned document — passport, diploma, bank statement, or more. Up to 50 pages, 25 MB.',
  },
  {
    icon: Cpu,
    title: 'AI translates every word',
    desc: 'Our AI reads the document, preserves names and numbers, and produces an accurate translation in minutes.',
  },
  {
    icon: Download,
    title: 'Download your translation',
    desc: 'Receive a clean, formatted PDF with a disclaimer on every page. Ready to share or attach to your application.',
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
  { code: '🇬🇧', name: 'English' },
  { code: '🇷🇺', name: 'Russian' },
  { code: '🇹🇭', name: 'Thai' },
  { code: '🇨🇳', name: 'Chinese' },
  { code: '🇰🇷', name: 'Korean' },
  { code: '🇯🇵', name: 'Japanese' },
  { code: '🇩🇪', name: 'German' },
  { code: '🇫🇷', name: 'French' },
  { code: '🇪🇸', name: 'Spanish' },
  { code: '🇸🇦', name: 'Arabic' },
];

const TRUST = [
  {
    icon: Zap,
    title: 'Fast — 2 to 5 minutes',
    desc: 'Most documents are ready in under 5 minutes. Traditional bureaus take days.',
  },
  {
    icon: BadgeDollarSign,
    title: 'Up to 3× cheaper',
    desc: '$9.99 per document vs $25–40 at a translation bureau. Same result, fraction of the price.',
  },
  {
    icon: Lock,
    title: 'Files auto-deleted after 30 days',
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
];

export default function Home() {
  return (
    <div className="bg-white">
      {/* HERO */}
      <section className="border-b bg-gradient-to-b from-slate-50 to-white px-4 py-20 text-center sm:py-28">
        <div className="mx-auto max-w-3xl">
          <div className="mb-4 inline-flex items-center rounded-full border bg-white px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
            AI-powered · Instant results · 10+ languages
          </div>
          <h1 className="mb-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
            Translate Any Document
            <br />
            <span className="text-primary">in Minutes</span>
          </h1>
          <p className="mx-auto mb-8 max-w-xl text-lg text-muted-foreground">
            AI-powered translation for passports, diplomas, contracts, bank statements and more.
            Accepted for review by consulates, universities, and immigration services.
          </p>
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button size="lg" className="px-8 text-base" render={<Link href="/auth/signup" />}>
              Translate Now
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="px-8 text-base"
              render={<a href="#how-it-works" />}
            >
              See How It Works
            </Button>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            From <strong>$9.99</strong> per document &nbsp;·&nbsp; Results in 2–5 minutes
            &nbsp;·&nbsp; 10+ languages
          </p>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-3 text-center text-3xl font-bold tracking-tight">How It Works</h2>
          <p className="mb-12 text-center text-muted-foreground">
            Three simple steps to your translated document
          </p>
          <div className="grid gap-8 sm:grid-cols-3">
            {HOW_IT_WORKS.map((step, i) => (
              <div key={i} className="flex flex-col items-center text-center">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                  <step.icon className="h-6 w-6 text-primary" />
                </div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Step {i + 1}
                </div>
                <h3 className="mb-2 text-lg font-semibold">{step.title}</h3>
                <p className="text-sm text-muted-foreground">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* DOCUMENT TYPES */}
      <section className="border-y bg-slate-50 px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-3 text-center text-3xl font-bold tracking-tight">
            Supported Document Types
          </h2>
          <p className="mb-12 text-center text-muted-foreground">
            We handle all common document types used in immigration, education, and finance
          </p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-3">
            {DOC_TYPES.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-xl border bg-white p-4 shadow-sm"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-4 w-4 text-primary" />
                </div>
                <span className="text-sm font-medium">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* LANGUAGES */}
      <section className="px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-3 text-center text-3xl font-bold tracking-tight">Supported Languages</h2>
          <p className="mb-12 text-center text-muted-foreground">
            More languages available — our AI handles them all
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {LANGUAGES.map(({ code, name }) => (
              <div
                key={name}
                className="flex items-center gap-3 rounded-xl border bg-white p-3 shadow-sm"
              >
                <span className="text-xl">{code}</span>
                <span className="text-sm font-medium">{name}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section className="border-y bg-slate-50 px-4 py-20">
        <div className="mx-auto max-w-md text-center">
          <h2 className="mb-3 text-3xl font-bold tracking-tight">Simple Pricing</h2>
          <p className="mb-10 text-muted-foreground">No subscription required — pay per document</p>
          <div className="rounded-2xl border bg-white p-8 shadow-md">
            <div className="mb-1 text-sm font-semibold uppercase tracking-widest text-primary">
              Per Document
            </div>
            <div className="mb-6 flex items-end justify-center gap-1">
              <span className="text-5xl font-bold tracking-tight">$9.99</span>
            </div>
            <ul className="mb-8 space-y-3 text-sm text-muted-foreground">
              {[
                'AI translation by Claude Sonnet',
                'Clean PDF output with disclaimer',
                'Instant delivery — 2 to 5 minutes',
                '10+ language pairs',
                'All document types supported',
              ].map((feat) => (
                <li key={feat} className="flex items-center gap-2">
                  <span className="text-primary">✓</span>
                  {feat}
                </li>
              ))}
            </ul>
            <Button size="lg" className="w-full text-base" render={<Link href="/auth/signup" />}>
              Start Translating
            </Button>
            <p className="mt-4 text-xs text-muted-foreground">No subscription · No hidden fees</p>
          </div>
        </div>
      </section>

      {/* TRUST / WHY US */}
      <section className="px-4 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="mb-3 text-center text-3xl font-bold tracking-tight">
            Why Docs Translator?
          </h2>
          <p className="mb-12 text-center text-muted-foreground">
            Fast, affordable, and private — built for people navigating bureaucracy abroad
          </p>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-xl border bg-white p-6 shadow-sm">
                <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-2 text-sm font-semibold">{title}</h3>
                <p className="text-sm text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-y bg-slate-50 px-4 py-20">
        <div className="mx-auto max-w-2xl">
          <h2 className="mb-3 text-center text-3xl font-bold tracking-tight">
            Frequently Asked Questions
          </h2>
          <p className="mb-10 text-center text-muted-foreground">
            Everything you need to know before you start
          </p>
          <div className="space-y-3">
            {FAQ.map(({ q, a }) => (
              <details
                key={q}
                className="group rounded-xl border bg-white px-5 py-4 shadow-sm open:pb-5"
              >
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold">
                  {q}
                  <span className="shrink-0 text-muted-foreground transition-transform group-open:rotate-180">
                    ▾
                  </span>
                </summary>
                <p className="mt-3 text-sm text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="px-4 py-24 text-center">
        <div className="mx-auto max-w-xl">
          <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to translate your document?
          </h2>
          <p className="mb-8 text-muted-foreground">
            Upload your PDF and get a translated version in minutes.
          </p>
          <Button
            size="lg"
            className="px-10 text-base"
            render={<Link href="/auth/signup" />}
          >
            Get Started — $9.99
          </Button>
          <p className="mt-4 text-sm text-muted-foreground">
            No subscription · Pay only when you translate
          </p>
        </div>
      </section>
    </div>
  );
}
