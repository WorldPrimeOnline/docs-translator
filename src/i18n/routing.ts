import { defineRouting } from 'next-intl/routing';
import { LOCALE_CODES, DEFAULT_LOCALE } from './locales';

export const routing = defineRouting({
  locales: LOCALE_CODES as unknown as [string, ...string[]],
  defaultLocale: DEFAULT_LOCALE,
  // All locales always have /{code}/ prefix. / redirects to /ru.
  localePrefix: 'always',
  localeCookie: true,
});

export type Locale = (typeof routing.locales)[number];
