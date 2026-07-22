/**
 * Confirms the web Pricing Lab (removed 2026-07-20 in favor of this CLI) has no remaining
 * trace in the public Next.js app — page, API routes, guards, env vars, or middleware
 * exceptions. See lib/default-pricing-version.ts / fixtures.ts for what was salvaged instead.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_PRICING_VERSION } from '../lib/default-pricing-version';

const REPO_ROOT = path.join(__dirname, '..', '..', '..');

function fileExists(relativePath: string): boolean {
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

function readIfExists(relativePath: string): string {
  const full = path.join(REPO_ROOT, relativePath);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf-8') : '';
}

describe('web Pricing Lab is fully removed', () => {
  it('the page route no longer exists', () => {
    expect(fileExists('src/app/[locale]/internal')).toBe(false);
  });

  it('the API routes no longer exist', () => {
    expect(fileExists('src/app/api/internal')).toBe(false);
  });

  it('the guard/access-check libs no longer exist', () => {
    expect(fileExists('src/lib/internal/pricing-lab-guard.ts')).toBe(false);
    expect(fileExists('src/lib/internal/require-pricing-lab-access.ts')).toBe(false);
  });

  it('middleware no longer has an /internal-specific auth exception', () => {
    const middleware = readIfExists('src/middleware.ts');
    expect(middleware).not.toMatch(/cleanPath\.startsWith\(['"]\/internal['"]\)/);
  });

  it('the cron cleanup route no longer sweeps a pricing-lab/ R2 prefix', () => {
    const cleanupRoute = readIfExists('src/app/api/cron/cleanup/route.ts');
    expect(cleanupRoute).not.toContain('pricing-lab/');
    expect(cleanupRoute).not.toContain('cleanupStalePricingLabFiles');
    expect(cleanupRoute).not.toContain('PRICING_LAB_RETENTION_HOURS');
  });

  it('no source file anywhere still references the deleted env vars or guard modules', () => {
    const forbidden = ['ENABLE_PRICING_LAB', 'PRICING_LAB_ALLOWED_EMAILS', 'pricing-lab-guard', 'require-pricing-lab-access'];
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', '.next', 'pricing-results', '.pricing-cache'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, out);
        } else if (/\.(ts|tsx)$/.test(entry.name) && !full.includes(`${path.sep}pricing-cli${path.sep}`)) {
          out.push(full);
        }
      }
      return out;
    };
    const files = walk(path.join(REPO_ROOT, 'src'));
    const hits: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      for (const needle of forbidden) {
        if (content.includes(needle)) hits.push(`${path.relative(REPO_ROOT, file)}: ${needle}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the built-in default pricing version salvaged the same numbers the old presets relied on', () => {
    expect(DEFAULT_PRICING_VERSION.code).toBe('2026-Q3-KZ-NEWMODEL');
    expect(DEFAULT_PRICING_VERSION.mrpValue).toBe(4.325);
    expect(DEFAULT_PRICING_VERSION.translatorPayoutRate).toBe(0.30);
  });
});
