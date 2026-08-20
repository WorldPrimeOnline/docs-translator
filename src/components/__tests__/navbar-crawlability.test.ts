/**
 * Regression guard for the 2026-08-20 SEO audit P0 fix: the navbar's dropdown child
 * links (kazakhstan/*, documents/*) were mounted only while the dropdown was open
 * (`{openDropdown === link.href && (...)}` / `{menuOpen && (...)}`), so they never
 * existed in the server-rendered DOM at all unless a user clicked — confirmed live via
 * curl that the production homepage HTML had zero hrefs to kazakhstan/documents/
 * passport anywhere. Fixed by always rendering the child <Link> elements and toggling
 * visibility with a CSS `hidden` class instead of JSX mount/unmount — same visual and
 * interactive behavior, but crawlable without a click.
 *
 * navbar.tsx imports next-intl/next/navigation client hooks — unresolvable here, the
 * same pre-existing ts-jest gap documented in landing-pages-metadata.test.ts and
 * internal-links-locale-aware.test.ts. Source-checked instead of rendered.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(path.join(__dirname, '../navbar.tsx'), 'utf-8');

describe('navbar dropdown children are always in the DOM (source-checked)', () => {
  it('does not JSX-conditionally mount the desktop dropdown panel on openDropdown', () => {
    expect(SRC).not.toMatch(/\{openDropdown === link\.href && \(/);
  });

  it('does not JSX-conditionally mount the mobile menu on menuOpen', () => {
    expect(SRC).not.toMatch(/\{menuOpen && \(/);
  });

  it('desktop dropdown panel is unconditionally rendered, visibility toggled via a hidden class', () => {
    expect(SRC).toMatch(/openDropdown === link\.href \? '' : 'hidden'/);
  });

  it('mobile menu is unconditionally rendered, visibility toggled via a hidden class', () => {
    expect(SRC).toMatch(/menuOpen \? '' : 'hidden'/);
  });

  it('every landing-cluster route is still present in NAV_LINKS data (nothing silently dropped while fixing rendering)', () => {
    for (const href of [
      "href: '/kazakhstan'",
      "href: '/kazakhstan/certified-translation'",
      "href: '/kazakhstan/notarized-translation'",
      "href: '/kazakhstan/university-document-translation'",
      "href: '/documents'",
      "href: '/documents/passport-translation'",
      "href: '/documents/diploma-translation'",
      "href: '/documents/bank-statement-translation'",
    ]) {
      expect(SRC).toContain(href);
    }
  });

  it('dropdown children still render as real next-intl Link elements, not plain <a> or buttons', () => {
    expect(SRC).toMatch(/link\.children\.map\(\(child\) => \(\s*<Link/);
  });
});
