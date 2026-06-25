export interface LocaleDefinition {
  code: string;
  label: string;
  nativeLabel: string;
  nativeShortLabel: string;
  flag: string;
  enabled: boolean;
}

// enabled: show in language switcher.
// Disabled locales redirect to /ru at middleware level — they are not publicly accessible.
export const LOCALES: LocaleDefinition[] = [
  { code: 'ru', label: 'Russian',    nativeLabel: 'Русский',   nativeShortLabel: 'Рус',  flag: '🇷🇺', enabled: true  },
  { code: 'en', label: 'English',    nativeLabel: 'English',   nativeShortLabel: 'Eng',  flag: '🇬🇧', enabled: true  },
  { code: 'kk', label: 'Kazakh',     nativeLabel: 'Қазақша',   nativeShortLabel: 'Қаз',  flag: '🇰🇿', enabled: true  },
  { code: 'zh', label: 'Chinese',    nativeLabel: '中文',       nativeShortLabel: '中文',  flag: '🇨🇳', enabled: false },
  { code: 'ko', label: 'Korean',     nativeLabel: '한국어',     nativeShortLabel: '한국어', flag: '🇰🇷', enabled: false },
  { code: 'tj', label: 'Tajik',      nativeLabel: 'Тоҷикӣ',   nativeShortLabel: 'Тоҷ',  flag: '🇹🇯', enabled: false },
  { code: 'uz', label: 'Uzbek',      nativeLabel: "O'zbek",    nativeShortLabel: "O'z",  flag: '🇺🇿', enabled: true  },
  { code: 'tk', label: 'Turkmen',    nativeLabel: 'Türkmen',   nativeShortLabel: 'Tkm',  flag: '🇹🇲', enabled: false },
  { code: 'mn', label: 'Mongolian',  nativeLabel: 'Монгол',    nativeShortLabel: 'Мон',  flag: '🇲🇳', enabled: false },
  { code: 'ky', label: 'Kyrgyz',     nativeLabel: 'Кыргызча',  nativeShortLabel: 'Кыр',  flag: '🇰🇬', enabled: true  },
  { code: 'de', label: 'German',     nativeLabel: 'Deutsch',   nativeShortLabel: 'De',   flag: '🇩🇪', enabled: true  },
  { code: 'es', label: 'Spanish',    nativeLabel: 'Español',   nativeShortLabel: 'Esp',  flag: '🇪🇸', enabled: false },
];

export const LOCALE_CODES = LOCALES.map((l) => l.code) as [string, ...string[]];

export const DEFAULT_LOCALE = 'ru';

/** Locale codes that are disabled and should redirect to DEFAULT_LOCALE at middleware level. */
export const DISABLED_LOCALE_CODES: ReadonlySet<string> = new Set(
  LOCALES.filter((l) => !l.enabled).map((l) => l.code),
);
