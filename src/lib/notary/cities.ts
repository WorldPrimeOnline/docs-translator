export interface NotaryCity {
  value: string;
  label: Record<string, string>;
}

export const NOTARY_CITIES: NotaryCity[] = [
  {
    value: 'almaty',
    label: {
      en: 'Almaty',
      ru: 'Алматы',
      kk: 'Алматы',
      zh: '阿拉木图',
      ko: '알마티',
      es: 'Almaty',
      tj: 'Алматы',
      uz: 'Almati',
      tk: 'Almatı',
      mn: 'Алматы',
      ky: 'Алматы',
    },
  },
];

export function getNotaryCityLabel(value: string, locale: string): string {
  const city = NOTARY_CITIES.find((c) => c.value === value);
  if (!city) return value;
  return city.label[locale] ?? city.label['en'] ?? value;
}

export function isValidNotaryCity(value: string): boolean {
  return NOTARY_CITIES.some((c) => c.value === value);
}
