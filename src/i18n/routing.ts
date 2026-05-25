import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'ru', 'zh', 'ko', 'kk'],
  defaultLocale: 'en',
  localePrefix: 'as-needed', // EN has no prefix (/), others get /ru/, /zh/, etc.
});

export type Locale = (typeof routing.locales)[number];
