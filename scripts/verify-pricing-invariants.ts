#!/usr/bin/env npx tsx
/**
 * Pre-deploy / startup pricing invariant gate (2026-07-28 decision).
 *
 * Before ANY deployment (staging or production) goes live, this must pass:
 *   1. There is exactly one ACTIVE pricing_versions row.
 *   2. Its code is the expected new-model code and its metadata.formula_version matches the
 *      expected formula version — the same check computeQuoteForJob() enforces per-request
 *      (src/lib/pricing/service.ts), but here it fails the BUILD, not a customer's checkout.
 *   3. Every supported non-Russian language (RU_TARGET_LANGUAGES below — the same 14 languages
 *      seeded by migration 0051 / tools/pricing-cli/lib/default-pricing-version.ts's
 *      RU_TARGET_RATES; kept in sync manually, same convention as this repo's other
 *      intentionally-duplicated cross-module constants) has an active, non-review base rate row
 *      in pricing_language_rates for the active version.
 *
 * Any violation exits 1 — wired into `npm run build` (see package.json's `build` script) so a
 * broken pricing config fails the Vercel build itself, before the new deployment is ever
 * promoted or serves a single request. The previous good deployment keeps serving traffic.
 *
 * Runs against WHATEVER environment's Supabase credentials are present at build time — that is
 * correct here (unlike scripts/staging/*.ts, which explicitly refuse on production): a build for
 * production must check production's actual pricing config, not staging's. Strictly read-only —
 * never writes anything.
 *
 * Skips gracefully (exit 0, prints a notice) when Supabase credentials are entirely absent —
 * i.e. a bare local `npm run build` with no env configured at all — so local iteration is never
 * blocked by this gate; only real staging/production builds (which always have real credentials
 * injected by Vercel) enforce it.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const ROOT = path.resolve(process.cwd());
function loadEnvFile(filename: string): boolean {
  const filepath = path.join(ROOT, filename);
  if (fs.existsSync(filepath)) { dotenv.config({ path: filepath }); return true; }
  return false;
}
loadEnvFile('.env.staging.local');
loadEnvFile('.env.local');

const EXPECTED_VERSION_CODE = '2026-Q3-KZ-NEWMODEL';
const EXPECTED_FORMULA_VERSION = 'new_2026_07_21';

/** Kept in sync manually with tools/pricing-cli/lib/default-pricing-version.ts's RU_TARGET_RATES. */
const RU_TARGET_LANGUAGES = ['kk', 'uz', 'ky', 'uk', 'be', 'en', 'de', 'fr', 'it', 'zh', 'ko', 'tr', 'th', 'ar'];

interface PricingVersionRow {
  id: string;
  code: string;
  status: string;
  metadata: Record<string, unknown> | null;
  valid_from: string;
  valid_to: string | null;
}

interface PricingLanguageRateRow {
  target_language: string;
  active: boolean;
  requires_operator_review: boolean;
}

async function main(): Promise<void> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.log('[verify-pricing-invariants] SKIPPED — no Supabase credentials in this build environment (expected for a bare local `npm run build`).');
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(supabaseUrl, serviceKey) as any;
  const violations: string[] = [];

  console.log(`[verify-pricing-invariants] Checking pricing config at ${supabaseUrl.replace(/\/\/.*@/, '//***@')}...`);

  const { data: versions, error: versionsError } = await db
    .from('pricing_versions')
    .select('id, code, status, metadata, valid_from, valid_to')
    .eq('status', 'active')
    .or(`valid_to.is.null,valid_to.gt.${new Date().toISOString()}`);

  if (versionsError) {
    violations.push(`Could not query pricing_versions: ${versionsError.message}`);
  } else {
    const activeVersions = (versions ?? []) as PricingVersionRow[];
    if (activeVersions.length === 0) {
      violations.push('No ACTIVE pricing_versions row found.');
    } else if (activeVersions.length > 1) {
      violations.push(`Expected exactly one ACTIVE pricing_versions row, found ${activeVersions.length}: ${activeVersions.map((v) => v.code).join(', ')}.`);
    } else {
      const version = activeVersions[0];
      if (version.code !== EXPECTED_VERSION_CODE) {
        violations.push(`Active pricing_versions.code is '${version.code}', expected '${EXPECTED_VERSION_CODE}'.`);
      }
      const formulaVersion = version.metadata?.formula_version;
      if (formulaVersion !== EXPECTED_FORMULA_VERSION) {
        violations.push(`Active pricing_versions.metadata.formula_version is '${String(formulaVersion)}', expected '${EXPECTED_FORMULA_VERSION}'.`);
      }

      if (version.code === EXPECTED_VERSION_CODE) {
        const { data: rates, error: ratesError } = await db
          .from('pricing_language_rates')
          .select('target_language, active, requires_operator_review')
          .eq('pricing_version_id', version.id)
          .eq('source_language', 'ru');

        if (ratesError) {
          violations.push(`Could not query pricing_language_rates: ${ratesError.message}`);
        } else {
          const rateByLanguage = new Map((rates as PricingLanguageRateRow[]).map((r) => [r.target_language, r]));
          for (const language of RU_TARGET_LANGUAGES) {
            const rate = rateByLanguage.get(language);
            if (!rate) {
              violations.push(`No pricing_language_rates row for ru -> ${language} under the active version.`);
            } else if (!rate.active) {
              violations.push(`pricing_language_rates row for ru -> ${language} is inactive.`);
            } else if (rate.requires_operator_review) {
              violations.push(`pricing_language_rates row for ru -> ${language} is marked requires_operator_review.`);
            }
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(`\n[verify-pricing-invariants] FAILED — ${violations.length} pricing config violation(s):`);
    for (const v of violations) console.error(`  - ${v}`);
    console.error('\nThis build must not go live with a broken pricing config. Fix the pricing_versions/pricing_language_rates rows and rebuild.');
    process.exit(1);
  }

  console.log(`[verify-pricing-invariants] OK — active version is ${EXPECTED_VERSION_CODE} (formula_version=${EXPECTED_FORMULA_VERSION}), all ${RU_TARGET_LANGUAGES.length} supported languages have an active base rate.`);
}

main().catch((err) => {
  console.error('[verify-pricing-invariants] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
