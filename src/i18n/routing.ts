import { defineRouting } from 'next-intl/routing';
import { LOCALE_CODES, DEFAULT_LOCALE } from './locales';

export const routing = defineRouting({
  locales: LOCALE_CODES as unknown as [string, ...string[]],
  defaultLocale: DEFAULT_LOCALE,
  // RU is default — no prefix for /. All other locales get /{code}/ prefix.
  localePrefix: 'as-needed',
  localeCookie: true,
});

export type Locale = (typeof routing.locales)[number];
