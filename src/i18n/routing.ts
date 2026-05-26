import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['en', 'ru', 'zh', 'ko', 'kk', 'tj', 'uz', 'tk', 'mn', 'ky', 'es'],
  defaultLocale: 'en',
  localePrefix: 'as-needed', // EN has no prefix (/), others get /ru/, /zh/, etc.
  localeCookie: true, // persist locale choice in NEXT_LOCALE cookie across navigations
});

export type Locale = (typeof routing.locales)[number];
