import type { Metadata } from 'next';
import { DEFAULT_LOCALE, LOCALES } from '@/i18n/locales';
import { LEGAL_SUPPORTED_LOCALES } from '@/lib/legal';

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

type EnabledLocale = 'ru' | 'en' | 'kk' | 'zh' | 'uz' | 'ky' | 'de' | 'tr' | 'th';

// Brand-approved homepage/sitewide copy, one real (non-machine-duplicated) entry per
// enabled locale (2026-08-20 SEO audit P1: all 9 previously shared one English string
// outside ru/en). Deliberately brand-first + generic "online document translation"
// intent, with no Kazakhstan-specific phrasing — buildLandingMetadata's kazakhstan
// copy owns that angle; keeping this generic avoids the two pages competing for the
// same query intent. Disabled locales never reach this (middleware redirects to /ru
// first); an unrecognized code falls back to English, never the old AI-translator
// positioning (see docs/ai-context/DECISIONS.md).
const COPY: Record<EnabledLocale, LocaleCopy> = {
  ru: {
    title: 'WPO Translations — перевод документов онлайн',
    description:
      'WPO Translations — перевод документов онлайн: электронный, официальный с проверкой переводчиком и нотариальное заверение через партнёра. Точная стоимость до оплаты.',
  },
  en: {
    title: 'WPO Translations — Online Document Translation',
    description:
      'Document translation online: electronic, official with translator review, and notarized translation through a partner. Exact pricing before you pay.',
  },
  kk: {
    title: 'WPO Translations — құжаттарды онлайн аудару',
    description:
      'WPO Translations — құжаттарды онлайн аудару: электрондық, аудармашы тексеруімен ресми аударма және серіктес арқылы нотариалды растау. Төлемге дейінгі нақты баға.',
  },
  zh: {
    title: 'WPO Translations — 在线文件翻译',
    description:
      'WPO Translations — 在线文件翻译：电子翻译、经译者审核的正式翻译，以及通过合作伙伴办理的公证翻译。付款前提供准确报价。',
  },
  uz: {
    title: 'WPO Translations — hujjatlarni onlayn tarjima qilish',
    description:
      "WPO Translations — hujjatlarni onlayn tarjima qilish: elektron, tarjimon tomonidan tekshirilgan rasmiy tarjima va hamkor orqali notarial tasdiqlash. To'lovdan oldin aniq narx.",
  },
  ky: {
    title: 'WPO Translations — документтерди онлайн котормо',
    description:
      'WPO Translations — документтерди онлайн которуу: электрондук, котормочу текшерген расмий котормо жана өнөктөш аркылуу нотариалдык күбөлөндүрүү. Төлөөгө чейин так баа.',
  },
  de: {
    title: 'WPO Translations — Online-Dokumentenübersetzung',
    description:
      'WPO Translations — Online-Dokumentenübersetzung: elektronisch, offiziell mit Übersetzerprüfung und notarielle Beglaubigung über einen Partner. Genauer Preis vor der Zahlung.',
  },
  tr: {
    title: 'WPO Translations — Çevrimiçi Belge Çevirisi',
    description:
      "WPO Translations — çevrimiçi belge çevirisi: elektronik, çevirmen kontrollü resmi çeviri ve bir partner aracılığıyla noter tasdiki. Ödemeden önce net fiyat.",
  },
  th: {
    title: 'WPO Translations — แปลเอกสารออนไลน์',
    description:
      'WPO Translations — แปลเอกสารออนไลน์: แปลอิเล็กทรอนิกส์ แปลทางการที่ตรวจสอบโดยนักแปล และรับรองเอกสารผ่านพาร์ทเนอร์ ราคาชัดเจนก่อนชำระเงิน',
  },
};

const OG_LOCALE: Record<EnabledLocale, string> = {
  ru: 'ru_RU',
  en: 'en_US',
  kk: 'kk_KZ',
  zh: 'zh_CN',
  uz: 'uz_UZ',
  ky: 'ky_KG',
  de: 'de_DE',
  tr: 'tr_TR',
  th: 'th_TH',
};

export function getLocaleCopy(locale: string): LocaleCopy {
  return COPY[locale as EnabledLocale] ?? COPY.en;
}

export function ogLocaleFor(locale: string): string {
  return OG_LOCALE[locale as EnabledLocale] ?? 'en_US';
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

  // Hreflang covers every enabled locale's homepage (SEO audit residual finding #3) —
  // never a disabled locale, same convention as buildLandingMetadata. Does not affect
  // title/description, which stay on the ru/en-only COPY fallback above (content
  // backlog, out of scope here).
  const languages: Record<string, string> = {};
  for (const { code, enabled } of LOCALES) {
    if (!enabled) continue;
    languages[code] = localeUrl(code);
  }
  languages['x-default'] = localeUrl(DEFAULT_LOCALE);

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

export interface LandingMetadataInput {
  /** Locale-unprefixed page path, e.g. '/documents/passport-translation'. No trailing slash. */
  path: string;
  /**
   * Locale-aware title/description (2026-08-20 SEO audit P0/P1 fix) — callers pass
   * `t('metaTitle')`/`t('metaDescription')` from that page's own i18n namespace
   * (messages/{locale}/landing-pages.json), the same getTranslations(namespace)
   * pattern already used for contacts/partners. One real value per enabled locale,
   * not a single static string reused everywhere.
   */
  title: string;
  description: string;
  /**
   * Locale codes to exclude from this page's hreflang alternates — use only for a
   * verified, documented content gap (missing i18n keys, not just "no translation
   * exists yet" for title/description). Do not add speculatively.
   */
  excludeFromHreflang?: string[];
  /**
   * Locale codes where THIS page gets explicit `noindex, follow` — for the same kind of
   * verified content gap as excludeFromHreflang (normally set together), where excluding
   * the URL from sitemap/hreflang alone still leaves it technically indexable if Google
   * finds it another way (e.g. a backlink). `follow: true` (not `follow: false`): the
   * page itself shouldn't rank, but its internal links don't need to be devalued.
   * canonical/hreflang/routing are otherwise untouched — noindex is the removal signal,
   * not a routing change. Do not add speculatively.
   */
  noindexForLocales?: string[];
}

/**
 * Landing page metadata (SEO audit finding #3; made locale-aware per the 2026-08-20
 * P0/P1 audit) — canonical + hreflang (enabled locales only, self-referencing this
 * exact page path — never the hub page or a different landing page) + minimal
 * OG/Twitter. title/description are locale-aware, sourced by the caller from i18n.
 * One helper shared by all 8 landing pages instead of duplicating this shape 8 times.
 */
export function buildLandingMetadata(locale: string, input: LandingMetadataInput): Metadata {
  const { path, title, description, excludeFromHreflang = [], noindexForLocales = [] } = input;
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

  const metadata: Metadata = {
    title,
    description,
    alternates: {
      // Self-canonical even when noindexForLocales applies to this locale: noindex is
      // the removal signal here, not canonical — cross-language-canonicalizing a broken
      // /de/... page onto its /en/... or /ru/... equivalent would be wrong (they're
      // different-language URLs, not duplicates of each other).
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

  if (noindexForLocales.includes(locale)) {
    metadata.robots = { index: false, follow: true };
  }

  return metadata;
}

export interface LegalMetadataInput {
  /** e.g. 'privacy', 'terms' — the page path is always `/legal/${slug}`. */
  slug: string;
  /** From the existing LegalDocument.metaTitle/.metaDescription (src/lib/legal/content/*.ts)
   * for whatever locale actually rendered (English, if this is a fallback render) —
   * never translated or invented here. */
  title: string;
  description: string;
}

/**
 * Legal page metadata (SEO audit finding #5) — one shared helper for all
 * locale × LEGAL_SLUGS combinations instead of duplicating this per slug.
 *
 * Self-canonical always, for both supported and fallback locales — never
 * cross-language-canonicalized onto the English/RU version, since a /de/legal/privacy
 * URL is not a duplicate of /en/legal/privacy, just an unsupported-language render of
 * the same URL.
 *
 * Supported locale (LEGAL_SUPPORTED_LOCALES): hreflang links only the other supported
 * locales for this exact slug (never a different slug, never de/tr/th, never a
 * disabled locale) + x-default → the default-locale version, same convention as
 * buildHomepageMetadata/buildLandingMetadata.
 *
 * Unsupported-but-enabled locale (de/tr/th today): no hreflang block at all — a
 * fallback render isn't a real translation, so it doesn't participate in the hreflang
 * graph as source or target — plus explicit `noindex, follow`. Disabled locales never
 * reach this function; middleware redirects them first (finding #10).
 */
export function buildLegalMetadata(locale: string, input: LegalMetadataInput): Metadata {
  const { slug, title, description } = input;
  const path = `/legal/${slug}`;
  const url = `${SITE_URL}/${locale}${path}`;
  const isSupported = LEGAL_SUPPORTED_LOCALES.includes(locale);

  const metadata: Metadata = {
    title,
    description,
    alternates: {
      canonical: url,
    },
  };

  if (isSupported) {
    const languages: Record<string, string> = {};
    for (const code of LEGAL_SUPPORTED_LOCALES) {
      languages[code] = `${SITE_URL}/${code}${path}`;
    }
    languages['x-default'] = `${SITE_URL}/${DEFAULT_LOCALE}${path}`;
    metadata.alternates!.languages = languages;
  } else {
    metadata.robots = { index: false, follow: true };
  }

  return metadata;
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
