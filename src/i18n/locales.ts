export interface LocaleDefinition {
  code: string;
  label: string;
  nativeLabel: string;
  flag: string;
  enabled: boolean;
}

export const LOCALES: LocaleDefinition[] = [
  { code: 'ru', label: 'Russian',    nativeLabel: 'Русский',   flag: '🇷🇺', enabled: true },
  { code: 'en', label: 'English',    nativeLabel: 'English',   flag: '🇬🇧', enabled: true },
  { code: 'kk', label: 'Kazakh',     nativeLabel: 'Қазақша',   flag: '🇰🇿', enabled: true },
  { code: 'zh', label: 'Chinese',    nativeLabel: '中文',       flag: '🇨🇳', enabled: true },
  { code: 'ko', label: 'Korean',     nativeLabel: '한국어',     flag: '🇰🇷', enabled: true },
  { code: 'tj', label: 'Tajik',      nativeLabel: 'Тоҷикӣ',   flag: '🇹🇯', enabled: true },
  { code: 'uz', label: 'Uzbek',      nativeLabel: "O'zbek",    flag: '🇺🇿', enabled: true },
  { code: 'tk', label: 'Turkmen',    nativeLabel: 'Türkmen',   flag: '🇹🇲', enabled: true },
  { code: 'mn', label: 'Mongolian',  nativeLabel: 'Монгол',    flag: '🇲🇳', enabled: true },
  { code: 'ky', label: 'Kyrgyz',     nativeLabel: 'Кыргызча',  flag: '🇰🇬', enabled: true },
  { code: 'es', label: 'Spanish',    nativeLabel: 'Español',   flag: '🇪🇸', enabled: true },
];

export const LOCALE_CODES = LOCALES.map((l) => l.code) as [string, ...string[]];

export const DEFAULT_LOCALE = 'ru';
