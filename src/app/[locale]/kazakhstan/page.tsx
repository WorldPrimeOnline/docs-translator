import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { kazakhstanConfig } from '@/lib/landing-pages/kazakhstan';

export const metadata: Metadata = {
  title: kazakhstanConfig.title,
  description: kazakhstanConfig.description,
};

export default async function KazakhstanPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('kazakhstan');

  const config = {
    ...kazakhstanConfig,
    hero: {
      ...kazakhstanConfig.hero,
      badge: t('heroBadge'),
      headline: t('heroHeadline'),
      accentLine: t('heroAccentLine'),
      subheadline: t('heroSubheadline'),
      ctaLabel: t('heroCtaLabel'),
      ctaSecondaryLabel: t('heroCtaSecondaryLabel'),
      trustLine: t('heroTrustLine'),
    },
    faq: {
      items: t.raw('faq') as Array<{ q: string; a: string }>,
    },
    finalCta: {
      ...kazakhstanConfig.finalCta!,
      headline: t('finalCtaHeadline'),
      sub: t('finalCtaSub'),
      cta: t('finalCtaCta'),
    },
  };

  return <LandingPage config={config} />;
}
