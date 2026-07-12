import type { Metadata } from 'next';
import { DEFAULT_LOCALE } from '@/i18n/locales';

// Canonical SEO domain. Deliberately hardcoded rather than reading
// NEXT_PUBLIC_SITE_URL: the apex (wpotranslations.org, used by that env var
// elsewhere — business-profile.ts, email templates, worker) 307-redirects to
// https://www.wpotranslations.org at the Vercel domain level, so www is what
// crawlers/link-preview bots actually resolve to. Using the apex here would
// point canonical/og:url at a URL that itself redirects.
export const SITE_URL = 'https://www.wpotranslations.org';
export const SITE_NAME = 'WPO Translations';

interface LocaleCopy {
  title: string;
  description: string;
}

// Brand-approved homepage/sitewide copy. Only ru/en are specified; every other
// locale (kk, zh, uz, ky, de, tr, th, and the disabled locales that redirect to
// /ru at middleware level) falls back to the English copy — never the old
// AI-translator-style positioning this replaced (see docs/ai-context/DECISIONS.md).
const COPY: Record<'ru' | 'en', LocaleCopy> = {
  ru: {
    title: 'WPO Translations — перевод документов онлайн',
    description:
      'Перевод документов для виз, учёбы, банков, миграции и релокации. Электронный, официальный и нотариальный перевод через партнёров. Цена рассчитывается онлайн.',
  },
  en: {
    title: 'WPO Translations — Online Document Translation',
    description:
      'Document translation for visas, education, banking, immigration and relocation. Electronic, official and notarized services with online pricing.',
  },
};

const OG_LOCALE: Record<string, string> = { ru: 'ru_RU', en: 'en_US' };

export function getLocaleCopy(locale: string): LocaleCopy {
  return COPY[locale as 'ru' | 'en'] ?? COPY.en;
}

export function ogLocaleFor(locale: string): string {
  return OG_LOCALE[locale] ?? 'en_US';
}

export function localeUrl(locale: string): string {
  return `${SITE_URL}/${locale}`;
}

/**
 * Sitewide fallback metadata for the root layout — used by any route that
 * doesn't define its own generateMetadata (dashboard, checkout, auth, etc).
 * Deliberately omits openGraph/twitter so those routes keep falling back to
 * plain <title>/<meta description> instead of inheriting the homepage's OG
 * data verbatim.
 */
export function buildFallbackMetadata(locale: string): Metadata {
  const { title, description } = getLocaleCopy(locale);
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    icons: {
      icon: { url: '/icon.png', sizes: '512x512', type: 'image/png' },
      apple: { url: '/icon.png', sizes: '512x512', type: 'image/png' },
    },
  };
}

/** Homepage metadata — title/description/OG/Twitter/canonical, all locale-aware. */
export function buildHomepageMetadata(locale: string): Metadata {
  const { title, description } = getLocaleCopy(locale);
  const url = localeUrl(locale);
  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages: {
        ru: localeUrl('ru'),
        en: localeUrl('en'),
        'x-default': localeUrl(DEFAULT_LOCALE),
      },
    },
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      locale: ogLocaleFor(locale),
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}
