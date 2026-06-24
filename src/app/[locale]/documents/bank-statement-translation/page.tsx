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
    docs: {
      ...bankStatementTranslationConfig.docs,
      headline: t('docsHeadline'),
      sectionLabel: t('docsSectionLabel'),
      items: bankStatementTranslationConfig.docs!.items.map((item, i) => ({
        ...item,
        name: t(`docItem${i + 1}`),
      })),
    },
    pain: {
      headline: t('painHeadline'),
      sectionLabel: t('painSectionLabel'),
      points: bankStatementTranslationConfig.pain!.points.map((_, i) => ({
        title: t(`pain${i + 1}Title`),
        desc: t(`pain${i + 1}Desc`),
      })),
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
    pricing: {
      ...bankStatementTranslationConfig.pricing!,
      headline: t('pricingHeadline'),
    },
  };

  return <LandingPage config={config} />;
}
