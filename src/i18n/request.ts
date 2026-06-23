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

  const loaded = await Promise.all(
    NAMESPACES.map((ns) =>
      import(`../../messages/${locale}/${ns}.json`).then((m) => ({
        ns,
        data: m.default as Record<string, unknown>,
      })),
    ),
  );

  // Detect key collisions before merging — two namespace files must not share a top-level key
  if (process.env.NODE_ENV !== 'production') {
    const seen = new Map<string, string>();
    for (const { ns, data } of loaded) {
      for (const key of Object.keys(data)) {
        if (seen.has(key)) {
          console.error(`[i18n] Key collision: "${key}" appears in both "${seen.get(key)}" and "${ns}" (locale: ${locale})`);
        }
        seen.set(key, ns);
      }
    }
  }

  const messages = Object.assign({}, ...loaded.map((l) => l.data)) as Record<string, unknown>;

  return { locale, messages };
});
