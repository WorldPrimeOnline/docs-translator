export type LegalSlug =
  | 'offer'
  | 'privacy'
  | 'personal-data-consent'
  | 'refund-policy'
  | 'disclaimer'
  | 'terms'
  | 'partners';

export const LEGAL_SLUGS: LegalSlug[] = [
  'offer',
  'privacy',
  'personal-data-consent',
  'refund-policy',
  'disclaimer',
  'terms',
  'partners',
];

export interface LegalSection {
  id: string;
  heading: string;
  /**
   * Each string is a paragraph.
   * Items starting with '•' render as list items.
   */
  body: string[];
}

export interface LegalDocument {
  slug: LegalSlug;
  title: string;
  metaTitle: string;
  metaDescription: string;
  effectiveDate?: string;
  sections: LegalSection[];
}

export type LegalDocs = Record<LegalSlug, LegalDocument>;
