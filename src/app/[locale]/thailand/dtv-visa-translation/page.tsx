import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { thailandDtvConfig } from '@/lib/landing-pages/thailand';

export const metadata: Metadata = {
  title: thailandDtvConfig.title,
  description: thailandDtvConfig.description,
};

export default async function ThailandDtvPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('thailandDtv');

  const config = {
    ...thailandDtvConfig,
    hero: {
      ...thailandDtvConfig.hero,
      badge: t('heroBadge'),
      headline: t('heroHeadline'),
      accentLine: t('heroAccentLine'),
      subheadline: t('heroSubheadline'),
      ctaLabel: t('heroCtaLabel'),
      trustLine: t('heroTrustLine'),
    },
    docs: {
      ...thailandDtvConfig.docs,
      headline: t('docsHeadline'),
      subheadline: t('docsSubheadline'),
      items: thailandDtvConfig.docs!.items.map((item, i) => ({
        ...item,
        name: t(`docItem${i + 1}`),
      })),
    },
    pain: {
      headline: t('painHeadline'),
      points: thailandDtvConfig.pain!.points.map((_, i) => ({
        title: t(`pain${i + 1}Title`),
        desc: t(`pain${i + 1}Desc`),
      })),
    },
    faq: {
      items: t.raw('faq') as Array<{ q: string; a: string }>,
    },
    finalCta: {
      ...thailandDtvConfig.finalCta!,
      headline: t('finalCtaHeadline'),
      sub: t('finalCtaSub'),
      cta: t('finalCtaCta'),
    },
  };

  return <LandingPage config={config} />;
}
