import type { LegalDocs, LegalDocument, LegalSlug } from './types';
import type { Locale } from '@/i18n/routing';

export { LEGAL_SLUGS } from './types';
export type { LegalSlug, LegalDocument, LegalDocs, LegalSection } from './types';

async function loadDocs(locale: Locale): Promise<LegalDocs> {
  switch (locale) {
    case 'ru': return (await import('./content/ru')).legalDocs;
    case 'zh': return (await import('./content/zh')).legalDocs;
    case 'ko': return (await import('./content/ko')).legalDocs;
    case 'kk': return (await import('./content/kk')).legalDocs;
    case 'tj': return (await import('./content/tj')).legalDocs;
    case 'uz': return (await import('./content/uz')).legalDocs;
    case 'tk': return (await import('./content/tk')).legalDocs;
    case 'mn': return (await import('./content/mn')).legalDocs;
    case 'ky': return (await import('./content/ky')).legalDocs;
    case 'es': return (await import('./content/es')).legalDocs;
    default:   return (await import('./content/en')).legalDocs;
  }
}

/**
 * Locales with a real, locale-specific content/{locale}.ts file (i.e. loadDocs()
 * above returns actual translated content, not the English `default` fallback).
 * `LegalDocs = Record<LegalSlug, LegalDocument>` is a Record type, so any file that
 * compiles is structurally guaranteed to cover all 7 LEGAL_SLUGS — there is no
 * partial/per-slug fallback today; a locale is either fully covered (own file exists)
 * or falls through entirely to English (no file — currently `de`, `tr`, `th`, verified
 * by the absence of content/{de,tr,th}.ts on disk, not by assumption).
 *
 * Single source of truth for which locale×legal-page combinations are real
 * translations vs. English fallback (SEO audit finding #5) — reused by
 * buildLegalMetadata (src/lib/seo/site-metadata.ts, for canonical/hreflang/noindex)
 * and src/app/sitemap.ts, so the two can never drift apart. Disabled locales are
 * irrelevant here regardless of content availability — middleware redirects them
 * before any page ever renders (SEO audit finding #10).
 *
 * If a locale ever gets partial per-slug translations, this would need to become a
 * locale×slug lookup instead of a flat locale list — not needed today.
 */
export const LEGAL_SUPPORTED_LOCALES: readonly string[] = ['ru', 'en', 'kk', 'zh', 'uz', 'ky'];

export async function getLegalDocument(
  locale: Locale,
  slug: LegalSlug,
): Promise<LegalDocument | null> {
  const docs = await loadDocs(locale);
  return docs[slug] ?? null;
}

export async function getLegalDocs(locale: Locale): Promise<LegalDocs> {
  return loadDocs(locale);
}
