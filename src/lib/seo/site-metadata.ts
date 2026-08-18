import type { Metadata } from 'next';
import { DEFAULT_LOCALE, LOCALES } from '@/i18n/locales';

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

export interface LandingMetadataInput {
  /** Locale-unprefixed page path, e.g. '/documents/passport-translation'. No trailing slash. */
  path: string;
  /**
   * From the page's LandingPageConfig.title/.description (src/lib/landing-pages/*.ts) —
   * whatever language that config currently contains (English for most; Russian for
   * kazakhstanConfig/kazakhstanNotarizedConfig — see SEO audit finding #3 report for why
   * that's not "invented" here, just made locale-independent rather than locale-aware).
   * This helper does not translate or vary title/description by locale — that's a
   * content decision out of scope for this technical-SEO fix.
   */
  title: string;
  description: string;
  /**
   * Locale codes to exclude from this page's hreflang alternates — use only for a
   * verified, documented content gap (missing i18n keys, not just "no translation
   * exists yet" for title/description). Do not add speculatively.
   */
  excludeFromHreflang?: string[];
}

/**
 * Landing page metadata (SEO audit finding #3) — canonical + hreflang (enabled locales
 * only, self-referencing this exact page path — never the hub page or a different
 * landing page) + minimal OG/Twitter, all locale-aware in URL even though
 * title/description are currently a single static string per page (see
 * LandingMetadataInput's doc comment). One helper shared by all 8 landing pages
 * instead of duplicating this shape 8 times.
 */
export function buildLandingMetadata(locale: string, input: LandingMetadataInput): Metadata {
  const { path, title, description, excludeFromHreflang = [] } = input;
  const url = `${SITE_URL}/${locale}${path}`;

  const languages: Record<string, string> = {};
  for (const { code, enabled } of LOCALES) {
    if (!enabled || excludeFromHreflang.includes(code)) continue;
    languages[code] = `${SITE_URL}/${code}${path}`;
  }
  // Same convention as buildHomepageMetadata: x-default points at the real
  // default-locale URL for this exact page, not an unprefixed/invented one —
  // localePrefix is 'always', so there is no bare-path canonical content URL.
  languages['x-default'] = `${SITE_URL}/${DEFAULT_LOCALE}${path}`;

  return {
    title,
    description,
    alternates: {
      canonical: url,
      languages,
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

/**
 * Explicit noindex for private/service surfaces (auth, dashboard, checkout, payment,
 * /start) — defense in depth alongside robots.txt's Disallow rules (SEO audit finding
 * #11). robots.txt only stops crawling; it does not stop a URL Google already knows
 * about (e.g. from a backlink) from appearing in search results without this tag.
 * Does not affect auth/access control, which is enforced independently in middleware.
 */
export const NOINDEX_METADATA: Metadata = {
  robots: { index: false, follow: false },
};
