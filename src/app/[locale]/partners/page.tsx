import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Metadata } from 'next';
import { PartnerApplicationForm } from '@/components/partners/PartnerApplicationForm';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('partnersPage');
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  };
}

export default async function PartnersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('partnersPage');

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="mb-20 text-center">
        <span className="mb-4 inline-block rounded-full border border-primary/30 bg-primary/10 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-primary">
          {t('hero.badge')}
        </span>
        <h1 className="mt-4 text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          {t('hero.title')}
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground">
          {t('hero.subtitle')}
        </p>
        <a
          href="#apply"
          className="mt-8 inline-block rounded-lg bg-primary px-7 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t('hero.cta')}
        </a>
      </section>

      {/* ── Who can partner ──────────────────────────────────────────────── */}
      <section className="mb-20">
        <h2 className="mb-8 text-2xl font-bold text-foreground">{t('whoCanPartner.title')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ['translatorTitle', 'translatorDesc'],
            ['notaryTitle', 'notaryDesc'],
            ['agencyTitle', 'agencyDesc'],
            ['visaCenterTitle', 'visaCenterDesc'],
            ['migrationConsultantTitle', 'migrationConsultantDesc'],
            ['educationAgencyTitle', 'educationAgencyDesc'],
            ['legalFirmTitle', 'legalFirmDesc'],
            ['corporateTitle', 'corporateDesc'],
          ] as const).map(([titleKey, descKey]) => (
            <div key={titleKey} className="rounded-xl border border-white/8 bg-card p-5">
              <p className="mb-1 font-semibold text-foreground">{t(`whoCanPartner.${titleKey}`)}</p>
              <p className="text-sm text-muted-foreground">{t(`whoCanPartner.${descKey}`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="mb-20">
        <h2 className="mb-8 text-2xl font-bold text-foreground">{t('howItWorks.title')}</h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ['step1Title', 'step1Desc'],
            ['step2Title', 'step2Desc'],
            ['step3Title', 'step3Desc'],
            ['step4Title', 'step4Desc'],
          ] as const).map(([titleKey, descKey], i) => (
            <div key={titleKey} className="relative rounded-xl border border-white/8 bg-card p-5">
              <span className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                {i + 1}
              </span>
              <p className="mb-1 font-semibold text-foreground">{t(`howItWorks.${titleKey}`)}</p>
              <p className="text-sm text-muted-foreground">{t(`howItWorks.${descKey}`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── For translators ──────────────────────────────────────────────── */}
      <section className="mb-16 rounded-2xl border border-white/8 bg-card p-8">
        <h2 className="mb-3 text-xl font-bold text-foreground">{t('forTranslators.title')}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{t('forTranslators.desc')}</p>
        <ul className="space-y-2">
          {(['point1', 'point2', 'point3', 'point4'] as const).map((k) => (
            <li key={k} className="flex gap-2 text-sm text-foreground">
              <span className="mt-0.5 shrink-0 text-primary">✓</span>
              {t(`forTranslators.${k}`)}
            </li>
          ))}
        </ul>
      </section>

      {/* ── For notaries ─────────────────────────────────────────────────── */}
      <section className="mb-16 rounded-2xl border border-white/8 bg-card p-8">
        <h2 className="mb-3 text-xl font-bold text-foreground">{t('forNotaries.title')}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{t('forNotaries.desc')}</p>
        <ul className="space-y-2">
          {(['point1', 'point2', 'point3'] as const).map((k) => (
            <li key={k} className="flex gap-2 text-sm text-foreground">
              <span className="mt-0.5 shrink-0 text-primary">✓</span>
              {t(`forNotaries.${k}`)}
            </li>
          ))}
        </ul>
      </section>

      {/* ── For organizations ────────────────────────────────────────────── */}
      <section className="mb-16 rounded-2xl border border-white/8 bg-card p-8">
        <h2 className="mb-3 text-xl font-bold text-foreground">{t('forOrganizations.title')}</h2>
        <p className="mb-4 text-sm text-muted-foreground">{t('forOrganizations.desc')}</p>
        <ul className="space-y-2">
          {(['point1', 'point2', 'point3', 'point4'] as const).map((k) => (
            <li key={k} className="flex gap-2 text-sm text-foreground">
              <span className="mt-0.5 shrink-0 text-primary">✓</span>
              {t(`forOrganizations.${k}`)}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Reward breakdown ─────────────────────────────────────────────── */}
      <section className="mb-20">
        <h2 className="mb-8 text-2xl font-bold text-foreground">{t('rewards.title')}</h2>
        <div className="grid gap-6 sm:grid-cols-2">

          {/* Org commission tiers */}
          <div className="rounded-xl border border-white/8 bg-card p-6">
            <p className="mb-3 font-semibold text-foreground">{t('rewards.orgTitle')}</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>{t('rewards.orgTier1')}</li>
              <li>{t('rewards.orgTier2')}</li>
              <li>{t('rewards.orgTier3')}</li>
            </ul>
          </div>

          {/* Translator client referral */}
          <div className="rounded-xl border border-white/8 bg-card p-6">
            <p className="mb-2 font-semibold text-foreground">{t('rewards.translatorClientTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('rewards.translatorClientDesc')}</p>
          </div>

          {/* Translator acquisition */}
          <div className="rounded-xl border border-white/8 bg-card p-6">
            <p className="mb-2 font-semibold text-foreground">{t('rewards.translatorAcquisitionTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('rewards.translatorAcquisitionDesc')}</p>
          </div>

          {/* Payout schedule */}
          <div className="rounded-xl border border-white/8 bg-card p-6">
            <p className="mb-2 font-semibold text-foreground">{t('rewards.payoutTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('rewards.payoutDesc')}</p>
          </div>

          {/* Commission base — full width */}
          <div className="rounded-xl border border-white/8 bg-card p-6 sm:col-span-2">
            <p className="mb-2 font-semibold text-foreground">{t('rewards.commissionBaseTitle')}</p>
            <p className="text-sm text-muted-foreground">{t('rewards.commissionBaseDesc')}</p>
          </div>
        </div>
      </section>

      {/* ── Disclaimer ───────────────────────────────────────────────────── */}
      <section className="mb-20 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-8">
        <h2 className="mb-4 text-base font-bold text-foreground">{t('disclaimer.title')}</h2>
        <ul className="space-y-3 text-sm text-muted-foreground">
          <li>{t('disclaimer.acceptance')}</li>
          <li>{t('disclaimer.notarization')}</li>
          <li>{t('disclaimer.rewards')}</li>
          <li>{t('disclaimer.passThrough')}</li>
        </ul>
      </section>

      {/* ── Application form ─────────────────────────────────────────────── */}
      <section id="apply" className="mx-auto max-w-xl scroll-mt-20">
        <h2 className="mb-2 text-2xl font-bold text-foreground">{t('form.title')}</h2>
        <p className="mb-8 text-sm text-muted-foreground">{t('form.subtitle')}</p>
        <PartnerApplicationForm />
      </section>

    </main>
  );
}
