import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { kazakhstanNotarizedConfig } from '@/lib/landing-pages/kazakhstan';
import { buildLandingMetadata } from '@/lib/seo/site-metadata';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('kazakhstanNotarized');
  return buildLandingMetadata(locale, {
    path: '/kazakhstan/notarized-translation',
    title: t('metaTitle'),
    description: t('metaDescription'),
  });
}

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
    docs: {
      ...kazakhstanNotarizedConfig.docs,
      sectionLabel: t('docsSectionLabel'),
      headline: t('docsHeadline'),
      items: kazakhstanNotarizedConfig.docs!.items.map((item, i) => ({
        ...item,
        name: t(`docItem${i + 1}`),
      })),
    },
    pain: {
      sectionLabel: t('painSectionLabel'),
      bridgeLabel: t('painBridgeLabel'),
      headline: t('painHeadline'),
      points: kazakhstanNotarizedConfig.pain!.points.map((_, i) => ({
        title: t(`pain${i + 1}Title`),
        desc: t(`pain${i + 1}Desc`),
      })),
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
    pricing: {
      ...kazakhstanNotarizedConfig.pricing!,
      headline: t('pricingHeadline'),
    },
  };

  return <LandingPage config={config} locale={locale} />;
}
