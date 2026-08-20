import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { kazakhstanUniversityConfig } from '@/lib/landing-pages/kazakhstan';
import { buildLandingMetadata } from '@/lib/seo/site-metadata';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('kazakhstanUniversity');
  return buildLandingMetadata(locale, {
    path: '/kazakhstan/university-document-translation',
    title: t('metaTitle'),
    description: t('metaDescription'),
    // messages/de/landing-pages.json is missing 18 keys under kazakhstanUniversity
    // (docs list + all 4 pain points) — verified via a full key-diff against en during
    // this fix's re-audit. Real content gap, not just "no SEO copy yet" — excluding /de
    // from hreflang here so we don't advertise it as an equivalent-language version of
    // this specific page, and from sitemap (src/app/sitemap.ts). Excluding from those
    // two alone still leaves the URL technically indexable if Google finds it another
    // way (e.g. a backlink), since the page itself renders 200 with literal i18n key
    // paths visible in place of the missing German text — noindex is the actual removal
    // signal. follow: true — internal links from the page don't need to be devalued,
    // only the page itself shouldn't rank. Translation work is out of scope for this task.
    excludeFromHreflang: ['de'],
    noindexForLocales: ['de'],
  });
}

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
      sectionLabel: t('docsSectionLabel'),
      items: kazakhstanUniversityConfig.docs!.items.map((item, i) => ({
        ...item,
        name: t(`docItem${i + 1}`),
      })),
    },
    pain: {
      headline: t('painHeadline'),
      sectionLabel: t('painSectionLabel'),
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

  return <LandingPage config={config} locale={locale} />;
}
