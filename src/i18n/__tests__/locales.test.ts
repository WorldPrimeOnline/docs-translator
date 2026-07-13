/**
 * Locks in the config that makes "/" resolve to "/ru" (not "/en").
 *
 * Note: the actual HTTP redirect (createIntlMiddleware(routing) inside
 * src/middleware.ts) can't be exercised here — next-intl's middleware/routing/
 * server subpaths ship ESM-only and are unresolvable under this repo's existing
 * ts-jest config (a pre-existing, repo-wide gap: even a bare
 * `import { defineRouting } from 'next-intl/routing'` fails the same way, and
 * no other test in the repo imports next-intl/middleware, next-intl/routing,
 * or next-intl/server directly). Widening jest.config.ts's transform to cover
 * next-intl would be a global change affecting every test in the repo, which
 * is out of scope here. The actual redirect chain was verified manually
 * against production: `curl -I https://www.wpotranslations.org/` (no
 * Accept-Language, no cookie — crawler-equivalent request) returns
 * `307 → location: /ru` with `Set-Cookie: NEXT_LOCALE=ru`.
 */
import { DEFAULT_LOCALE, LOCALE_CODES, DISABLED_LOCALE_CODES } from '../locales';

describe('locale configuration — root URL defaults to /ru', () => {
  it('DEFAULT_LOCALE is ru, not en', () => {
    expect(DEFAULT_LOCALE).toBe('ru');
  });

  it('ru and en are both valid, non-disabled locale codes', () => {
    expect(LOCALE_CODES).toContain('ru');
    expect(LOCALE_CODES).toContain('en');
    expect(DISABLED_LOCALE_CODES.has('ru')).toBe(false);
    expect(DISABLED_LOCALE_CODES.has('en')).toBe(false);
  });
});
