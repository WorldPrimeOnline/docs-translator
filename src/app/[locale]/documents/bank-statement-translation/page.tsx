import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { bankStatementTranslationConfig } from '@/lib/landing-pages/documents';

export const metadata: Metadata = {
  title: bankStatementTranslationConfig.title,
  description: bankStatementTranslationConfig.description,
};

export default async function BankStatementTranslationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('bankStatementTranslation');

  const config = {
    ...bankStatementTranslationConfig,
    hero: {
      ...bankStatementTranslationConfig.hero,
      badge: t('heroBadge'),
      headline: t('heroHeadline'),
      accentLine: t('heroAccentLine'),
      subheadline: t('heroSubheadline'),
      ctaLabel: t('heroCtaLabel'),
      trustLine: t('heroTrustLine'),
    },
    faq: {
      items: t.raw('faq') as Array<{ q: string; a: string }>,
    },
    finalCta: {
      ...bankStatementTranslationConfig.finalCta!,
      headline: t('finalCtaHeadline'),
      sub: t('finalCtaSub'),
      cta: t('finalCtaCta'),
    },
  };

  return <LandingPage config={config} />;
}
