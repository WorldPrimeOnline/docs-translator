import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { diplomaTranslationConfig } from '@/lib/landing-pages/documents';

export const metadata: Metadata = {
  title: diplomaTranslationConfig.title,
  description: diplomaTranslationConfig.description,
};

export default async function DiplomaTranslationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('diplomaTranslation');

  const config = {
    ...diplomaTranslationConfig,
    hero: {
      ...diplomaTranslationConfig.hero,
      badge: t('heroBadge'),
      headline: t('heroHeadline'),
      accentLine: t('heroAccentLine'),
      subheadline: t('heroSubheadline'),
      ctaLabel: t('heroCtaLabel'),
      trustLine: t('heroTrustLine'),
    },
    docs: {
      ...diplomaTranslationConfig.docs,
      headline: t('docsHeadline'),
      sectionLabel: t('docsSectionLabel'),
      items: diplomaTranslationConfig.docs!.items.map((item, i) => ({
        ...item,
        name: t(`docItem${i + 1}`),
      })),
    },
    pain: {
      headline: t('painHeadline'),
      sectionLabel: t('painSectionLabel'),
      points: diplomaTranslationConfig.pain!.points.map((_, i) => ({
        title: t(`pain${i + 1}Title`),
        desc: t(`pain${i + 1}Desc`),
      })),
    },
    faq: {
      items: t.raw('faq') as Array<{ q: string; a: string }>,
    },
    finalCta: {
      ...diplomaTranslationConfig.finalCta!,
      headline: t('finalCtaHeadline'),
      sub: t('finalCtaSub'),
      cta: t('finalCtaCta'),
    },
    pricing: {
      ...diplomaTranslationConfig.pricing!,
      headline: t('pricingHeadline'),
    },
  };

  return <LandingPage config={config} />;
}
