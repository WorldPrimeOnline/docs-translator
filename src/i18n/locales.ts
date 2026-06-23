export interface LocaleDefinition {
  code: string;
  label: string;
  nativeLabel: string;
  flag: string;
  enabled: boolean;
}

// enabled: show in language switcher. Set false for locales with TODO_I18N in critical namespaces.
// Routing still works for all locales — disabled means "not advertised", not "blocked".
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
