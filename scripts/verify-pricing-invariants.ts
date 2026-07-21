#!/usr/bin/env npx tsx
/**
 * Pre-deploy / startup pricing invariant gate (2026-07-28 decision, revised 2026-07-29 for the
 * production cutover — see docs/ai-context/DECISIONS.md).
 *
 * Before ANY deployment (staging or production) goes live, this must pass:
 *   1. A pricing_versions row with the expected NEWMODEL code exists AT ALL — deliberately NOT
 *      gated on status='active'. The 2026-07-29 production cutover plan requires NEWMODEL to be
 *      fully prepared and deployed while MVP is STILL the active version (old code/deployment
 *      still serving traffic) — the operator flips MVP->archived / NEWMODEL->active in one
 *      transaction only AFTER confirming the new deployment is live. Gating this build check on
 *      status='active' would make that exact sequence impossible to build/deploy at all.
 *   2. Its metadata.formula_version matches the expected formula version.
 *   3. Every supported non-Russian language (RU_TARGET_LANGUAGES below — the same 14 languages
 *      seeded by migration 0051 / tools/pricing-cli/lib/default-pricing-version.ts's
 *      RU_TARGET_RATES; kept in sync manually, same convention as this repo's other
 *      intentionally-duplicated cross-module constants) has an active, non-review base rate row
 *      in pricing_language_rates for the NEWMODEL version — regardless of whether NEWMODEL is
 *      the currently-active version.
 *
 * This is a BUILD-time readiness check only. The RUNTIME gate stays strict and unchanged
 * (computeQuoteForJob in src/lib/pricing/service.ts still requires the ACTUAL active version to
 * be NEWMODEL with the correct formula_version before pricing Official/Notary) — so Official/
 * Notary checkout correctly stays hard-blocked (PRICING_VERSION_MISMATCH, never a fabricated
 * price) for the entire window between this deployment going live and the operator's manual
 * MVP->archived / NEWMODEL->active cutover.
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

  // Deliberately NOT filtered on status='active' — see the docblock above. NEWMODEL must exist
  // and be fully prepared regardless of which version is currently the live/active one.
  const { data: versionRows, error: versionsError } = await db
    .from('pricing_versions')
    .select('id, code, status, metadata')
    .eq('code', EXPECTED_VERSION_CODE);

  if (versionsError) {
    violations.push(`Could not query pricing_versions: ${versionsError.message}`);
  } else {
    const matches = (versionRows ?? []) as PricingVersionRow[];
    if (matches.length === 0) {
      violations.push(`No pricing_versions row with code '${EXPECTED_VERSION_CODE}' exists.`);
    } else {
      if (matches.length > 1) {
        violations.push(`Expected exactly one pricing_versions row with code '${EXPECTED_VERSION_CODE}', found ${matches.length}.`);
      }
      const version = matches[0];
      console.log(`[verify-pricing-invariants] Found ${EXPECTED_VERSION_CODE} (status='${version.status}') — build check does not require status='active'; the runtime gate in computeQuoteForJob() still does.`);

      const formulaVersion = version.metadata?.formula_version;
      if (formulaVersion !== EXPECTED_FORMULA_VERSION) {
        violations.push(`pricing_versions '${EXPECTED_VERSION_CODE}'.metadata.formula_version is '${String(formulaVersion)}', expected '${EXPECTED_FORMULA_VERSION}'.`);
      }

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
            violations.push(`No pricing_language_rates row for ru -> ${language} under ${EXPECTED_VERSION_CODE}.`);
          } else if (!rate.active) {
            violations.push(`pricing_language_rates row for ru -> ${language} is inactive.`);
          } else if (rate.requires_operator_review) {
            violations.push(`pricing_language_rates row for ru -> ${language} is marked requires_operator_review.`);
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error(`\n[verify-pricing-invariants] FAILED — ${violations.length} pricing config violation(s):`);
    for (const v of violations) console.error(`  - ${v}`);
    console.error(`\nThis build must not go live without ${EXPECTED_VERSION_CODE} fully prepared. Fix the pricing_versions/pricing_language_rates rows and rebuild.`);
    process.exit(1);
  }

  console.log(`[verify-pricing-invariants] OK — ${EXPECTED_VERSION_CODE} exists with formula_version=${EXPECTED_FORMULA_VERSION}, all ${RU_TARGET_LANGUAGES.length} supported languages have an active base rate. (status='active' not required at build time — runtime gate stays strict.)`);
}

main().catch((err) => {
  console.error('[verify-pricing-invariants] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
