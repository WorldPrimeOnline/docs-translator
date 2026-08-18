/**
 * Regression guard for the docs-translator.vercel.app SEO-duplicate incident
 * (SEO audit finding #2): that Vercel project-default alias was found live,
 * unprotected, and serving a full crawlable mirror of production. Fixed via a
 * host-matched permanent redirect in next.config.ts's redirects().
 */
type RedirectRule = {
  source: string;
  has?: Array<{ type: string; value: string }>;
  destination: string;
  permanent: boolean;
};

// Named distinctly from csp.test.ts's own loadConfig() — neither file has a
// top-level import/export, so TypeScript treats them as global scripts and a
// same-named top-level function declaration in both would collide.
function loadRedirectsConfig(): { redirects: () => Promise<RedirectRule[]> } {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../../next.config');
  return (mod.default ?? mod) as { redirects: () => Promise<RedirectRule[]> };
}

describe('next.config redirects — old docs-translator.vercel.app alias', () => {
  it('redirects the exact docs-translator.vercel.app host to the production domain', async () => {
    const config = loadRedirectsConfig();
    const rules = await config.redirects();

    const rule = rules.find((r) =>
      r.has?.some((h) => h.type === 'host' && h.value === 'docs-translator.vercel.app'),
    );

    expect(rule).toBeDefined();
    expect(rule!.permanent).toBe(true); // 308, not a temporary 307
    expect(rule!.destination).toBe('https://www.wpotranslations.org/:path*');
    expect(rule!.source).toBe('/:path*'); // preserves the full path (query is preserved by Next.js automatically)
  });

  it('destination matches the canonical SITE_URL used sitewide for canonical/OG/sitemap', () => {
    // Kept as a literal in next.config.ts (see comment there for why it can't import
    // '@/lib/seo/site-metadata'). This test is the tripwire if the two ever diverge.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { SITE_URL } = require('../lib/seo/site-metadata');
    expect(SITE_URL).toBe('https://www.wpotranslations.org');
  });
});
