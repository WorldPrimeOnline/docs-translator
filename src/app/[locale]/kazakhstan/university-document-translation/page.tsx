import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { kazakhstanUniversityConfig } from '@/lib/landing-pages/kazakhstan';

export const metadata: Metadata = {
  title: kazakhstanUniversityConfig.title,
  description: kazakhstanUniversityConfig.description,
};

export default async function KazakhstanUniversityPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('kazakhstanUniversity');

  const config = {
    ...kazakhstanUniversityConfig,
    hero: {
      ...kazakhstanUniversityConfig.hero,
      badge: t('heroBadge'),
      headline: t('heroHeadline'),
      accentLine: t('heroAccentLine'),
      subheadline: t('heroSubheadline'),
      ctaLabel: t('heroCtaLabel'),
      trustLine: t('heroTrustLine'),
    },
    docs: {
      ...kazakhstanUniversityConfig.docs,
      headline: t('docsHeadline'),
      items: kazakhstanUniversityConfig.docs!.items.map((item, i) => ({
        ...item,
        name: t(`docItem${i + 1}`),
      })),
    },
    pain: {
      headline: t('painHeadline'),
      points: kazakhstanUniversityConfig.pain!.points.map((_, i) => ({
        title: t(`pain${i + 1}Title`),
        desc: t(`pain${i + 1}Desc`),
      })),
    },
    faq: {
      items: t.raw('faq') as Array<{ q: string; a: string }>,
    },
    finalCta: {
      ...kazakhstanUniversityConfig.finalCta!,
      headline: t('finalCtaHeadline'),
      sub: t('finalCtaSub'),
      cta: t('finalCtaCta'),
    },
    pricing: {
      ...kazakhstanUniversityConfig.pricing!,
      headline: t('pricingHeadline'),
    },
  };

  return <LandingPage config={config} />;
}
