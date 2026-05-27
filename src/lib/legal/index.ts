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
