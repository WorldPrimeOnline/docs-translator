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
    pain: {
      sectionLabel: t('painSectionLabel'),
      bridgeLabel: t('painBridgeLabel'),
      headline: t('painHeadline'),
      points: kazakhstanConfig.pain!.points.map((_, i) => ({
        title: t(`pain${i + 1}Title`),
        desc: t(`pain${i + 1}Desc`),
      })),
    },
    docs: {
      ...kazakhstanConfig.docs,
      sectionLabel: t('docsSectionLabel'),
      headline: t('docsHeadline'),
      subheadline: t('docsSubheadline'),
      items: kazakhstanConfig.docs!.items.map((item, i) => ({
        ...item,
        name: t(`docItem${i + 1}`),
      })),
    },
    trust: {
      ...kazakhstanConfig.trust!,
      headline: t('trustHeadline'),
    },
    pricing: {
      ...kazakhstanConfig.pricing!,
      headline: t('pricingHeadline'),
      subheadline: t('pricingSubheadline'),
    },
    seoContent: {
      headline: t('seoHeadline'),
      paragraphs: [t('seoParagraph1'), t('seoParagraph2'), t('seoParagraph3')],
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
