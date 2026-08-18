/**
 * Regression guard for SEO audit finding #7: the standalone /privacy and /tos pages
 * were deleted (they now 308-redirect via next.config.ts — see
 * legal-alias-redirects.test.ts). This locks in that they stay deleted and that no
 * internal UI ever links to them directly (the re-audit found zero such links before
 * this fix — footer and OrderForm consent links already pointed at /legal/privacy,
 * /legal/terms, /legal/offer, /legal/personal-data-consent).
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..');

describe('standalone /privacy and /tos pages', () => {
  it('page.tsx files no longer exist', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'src/app/[locale]/privacy/page.tsx'))).toBe(false);
    expect(fs.existsSync(path.join(REPO_ROOT, 'src/app/[locale]/tos/page.tsx'))).toBe(false);
  });

  it('no source file links to /privacy or /tos as an internal href (redirect config and this test file itself are exempt)', () => {
    const EXEMPT_FILES = new Set(['next.config.ts', 'src/__tests__/legal-alias-redirects.test.ts', 'src/__tests__/legal-alias-cleanup.test.ts']);

    function walk(dir: string, results: string[]): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, results);
        } else if (/\.(ts|tsx)$/.test(entry.name)) {
          results.push(full);
        }
      }
    }

    const files: string[] = [];
    walk(path.join(REPO_ROOT, 'src'), files);

    const offenders: string[] = [];
    for (const file of files) {
      const relPath = path.relative(REPO_ROOT, file).split(path.sep).join('/');
      if (EXEMPT_FILES.has(relPath)) continue;
      const src = fs.readFileSync(file, 'utf-8');
      // href="/privacy", href='/tos', pathname: '/privacy', etc. — a hrefLang or a
      // path segment like /legal/privacy or /documents/privacy-... must not match.
      if (/(?:href|pathname)\s*[:=]\s*\{?\s*['"`]\/(?:privacy|tos)['"`]/.test(src)) {
        offenders.push(relPath);
      }
    }

    expect(offenders).toEqual([]);
  });
});
