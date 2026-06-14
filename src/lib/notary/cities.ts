// Centralized notary city configuration.
// TODO: populate this list — owner must provide supported cities before enabling notarization_through_partners.
// Each entry: { value: string (slug), label: Record<locale, string> }

export interface NotaryCity {
  value: string;
  label: Record<string, string>;
}

export const NOTARY_CITIES: NotaryCity[] = [
  // Cities will be added here once confirmed by business owner.
  // Example format:
  // { value: 'almaty',  label: { en: 'Almaty',  ru: 'Алматы',  kk: 'Алматы' } },
  // { value: 'astana',  label: { en: 'Astana',  ru: 'Астана',  kk: 'Астана' } },
];

export function getNotaryCityLabel(value: string, locale: string): string {
  const city = NOTARY_CITIES.find((c) => c.value === value);
  if (!city) return value;
  return city.label[locale] ?? city.label['en'] ?? value;
}

export function isValidNotaryCity(value: string): boolean {
  return NOTARY_CITIES.some((c) => c.value === value);
}
