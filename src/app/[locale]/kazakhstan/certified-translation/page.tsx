import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { kazakhstanCertifiedConfig } from '@/lib/landing-pages/kazakhstan';

export const metadata: Metadata = {
  title: kazakhstanCertifiedConfig.title,
  description: kazakhstanCertifiedConfig.description,
};

export default async function KazakhstanCertifiedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('kazakhstanCertified');

  const config = {
    ...kazakhstanCertifiedConfig,
    hero: {
      ...kazakhstanCertifiedConfig.hero,
      badge: t('heroBadge'),
      headline: t('heroHeadline'),
      accentLine: t('heroAccentLine'),
      subheadline: t('heroSubheadline'),
      ctaLabel: t('heroCtaLabel'),
      trustLine: t('heroTrustLine'),
    },
    pain: {
      ...kazakhstanCertifiedConfig.pain!,
      sectionLabel: t('painSectionLabel'),
      bridgeLabel: t('painBridgeLabel'),
      headline: t('painHeadline'),
      points: kazakhstanCertifiedConfig.pain!.points.map((_, i) => ({
        title: t(`pain${i + 1}Title`),
        desc: t(`pain${i + 1}Desc`),
      })),
    },
    faq: {
      items: t.raw('faq') as Array<{ q: string; a: string }>,
    },
    finalCta: {
      ...kazakhstanCertifiedConfig.finalCta!,
      headline: t('finalCtaHeadline'),
      sub: t('finalCtaSub'),
      cta: t('finalCtaCta'),
    },
    docs: {
      ...kazakhstanCertifiedConfig.docs!,
      headline: t('docsHeadline'),
      sectionLabel: t('docsSectionLabel'),
      items: kazakhstanCertifiedConfig.docs!.items.map((item, i) => ({
        ...item,
        name: (t.raw('docsItems') as string[])[i] ?? item.name,
      })),
    },
    pricing: {
      ...kazakhstanCertifiedConfig.pricing!,
      headline: t('pricingHeadline'),
      subheadline: t('pricingSubheadline'),
    },
  };

  return <LandingPage config={config} />;
}
