import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';

const NAMESPACES = [
  'navigation',
  'home',
  'pricing',
  'landing-pages',
  'footer',
  'auth',
  'order',
  'checkout',
  'legal',
  'common',
  'errors',
] as const;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  const parts = await Promise.all(
    NAMESPACES.map((ns) =>
      import(`../../messages/${locale}/${ns}.json`).then((m) => m.default as Record<string, unknown>),
    ),
  );

  const messages = Object.assign({}, ...parts) as Record<string, unknown>;

  return { locale, messages };
});
