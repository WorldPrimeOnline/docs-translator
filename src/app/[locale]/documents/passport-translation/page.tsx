import type { Metadata } from 'next';
import { setRequestLocale, getTranslations } from 'next-intl/server';
import { LandingPage } from '@/components/landing/LandingPage';
import { passportTranslationConfig } from '@/lib/landing-pages/documents';
import { buildLandingMetadata } from '@/lib/seo/site-metadata';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  return buildLandingMetadata(locale, {
    path: '/documents/passport-translation',
    title: passportTranslationConfig.title,
    description: passportTranslationConfig.description,
    // Yandex snippet-quality fix (2026-08-19): base title/description above are
    // English-only, so RU queries (e.g. "перевод паспорта алматы wpo") had no
    // RU-specific signal on this page and Yandex sometimes surfaced the homepage
    // instead. RU-only override — en/kk/other locales keep the config copy above.
    ruOverride: {
      title: 'Перевод паспорта онлайн — WPO Translations',
      description:
        'Перевод паспорта онлайн для виз, банков и миграционных задач. Электронный и официальный перевод; нотариальное заверение — через партнёрский процесс.',
    },
  });
}

export default async function PassportTranslationPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('passportTranslation');

  const config = {
    ...passportTranslationConfig,
    hero: {
      ...passportTranslationConfig.hero,
      badge: t('heroBadge'),
      headline: t('heroHeadline'),
      accentLine: t('heroAccentLine'),
      subheadline: t('heroSubheadline'),
      ctaLabel: t('heroCtaLabel'),
      trustLine: t('heroTrustLine'),
    },
    docs: {
      ...passportTranslationConfig.docs,
      headline: t('docsHeadline'),
      sectionLabel: t('docsSectionLabel'),
      items: passportTranslationConfig.docs!.items.map((item, i) => ({
        ...item,
        name: t(`docItem${i + 1}` as Parameters<typeof t>[0]),
      })),
    },
    pain: {
      ...passportTranslationConfig.pain!,
      headline: t('painHeadline'),
      sectionLabel: t('painSectionLabel'),
      bridgeLabel: t('painBridgeLabel'),
      points: passportTranslationConfig.pain!.points.map((_, i) => ({
        title: t(`pain${i + 1}Title` as Parameters<typeof t>[0]),
        desc: t(`pain${i + 1}Desc` as Parameters<typeof t>[0]),
      })),
    },
    faq: {
      items: t.raw('faq') as Array<{ q: string; a: string }>,
    },
    finalCta: {
      ...passportTranslationConfig.finalCta!,
      headline: t('finalCtaHeadline'),
      sub: t('finalCtaSub'),
      cta: t('finalCtaCta'),
    },
    pricing: {
      ...passportTranslationConfig.pricing!,
      headline: t('pricingHeadline'),
    },
  };

  return <LandingPage config={config} />;
}
