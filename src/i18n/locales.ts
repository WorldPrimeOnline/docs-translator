export interface LocaleDefinition {
  code: string;
  label: string;
  nativeLabel: string;
  flag: string;
  enabled: boolean;
}

// enabled: show in language switcher.
// Disabled locales redirect to /ru at middleware level — they are not publicly accessible.
export const LOCALES: LocaleDefinition[] = [
  { code: 'ru', label: 'Russian',    nativeLabel: 'Русский',   flag: '🇷🇺', enabled: true  },
  { code: 'en', label: 'English',    nativeLabel: 'English',   flag: '🇬🇧', enabled: true  },
  { code: 'kk', label: 'Kazakh',     nativeLabel: 'Қазақша',   flag: '🇰🇿', enabled: true  },
  { code: 'zh', label: 'Chinese',    nativeLabel: '中文',       flag: '🇨🇳', enabled: false },
  { code: 'ko', label: 'Korean',     nativeLabel: '한국어',     flag: '🇰🇷', enabled: false },
  { code: 'tj', label: 'Tajik',      nativeLabel: 'Тоҷикӣ',   flag: '🇹🇯', enabled: false },
  { code: 'uz', label: 'Uzbek',      nativeLabel: "O'zbek",    flag: '🇺🇿', enabled: false },
  { code: 'tk', label: 'Turkmen',    nativeLabel: 'Türkmen',   flag: '🇹🇲', enabled: false },
  { code: 'mn', label: 'Mongolian',  nativeLabel: 'Монгол',    flag: '🇲🇳', enabled: false },
  { code: 'ky', label: 'Kyrgyz',     nativeLabel: 'Кыргызча',  flag: '🇰🇬', enabled: false },
  { code: 'es', label: 'Spanish',    nativeLabel: 'Español',   flag: '🇪🇸', enabled: false },
];

export const LOCALE_CODES = LOCALES.map((l) => l.code) as [string, ...string[]];

export const DEFAULT_LOCALE = 'ru';

/** Locale codes that are disabled and should redirect to DEFAULT_LOCALE at middleware level. */
export const DISABLED_LOCALE_CODES: ReadonlySet<string> = new Set(
  LOCALES.filter((l) => !l.enabled).map((l) => l.code),
);
