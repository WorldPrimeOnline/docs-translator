import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { kazakhstanNotarizedConfig } from '@/lib/landing-pages/kazakhstan';

export const metadata: Metadata = {
  title: kazakhstanNotarizedConfig.title,
  description: kazakhstanNotarizedConfig.description,
};

export default async function KazakhstanNotarizedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('kazakhstanNotarized');

  const config = {
    ...kazakhstanNotarizedConfig,
    hero: {
      ...kazakhstanNotarizedConfig.hero,
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
      ...kazakhstanNotarizedConfig.finalCta!,
      headline: t('finalCtaHeadline'),
      sub: t('finalCtaSub'),
      cta: t('finalCtaCta'),
    },
  };

  return <LandingPage config={config} />;
}
