/**
 * REAL staging integration test (2026-07-27 incident): saveQuote() failed with
 * "null value in column "included_word_count" of relation "price_quotes" violates not-null
 * constraint" on a real 7400 KZT Official quote. Every other test in this suite (service.test.ts)
 * mocks supabaseServer.from() entirely — a mock accepts whatever payload it's handed and can
 * never catch a real Postgres NOT NULL/CHECK constraint violation. This test performs a REAL
 * insert (immediately cleaned up) against the actual staging price_quotes table, proving
 * saveQuote()'s current payload is genuinely accepted by the schema as migrated through 0062
 * (included_word_count/included_page_count made nullable — see that migration's comment for the
 * root cause).
 *
 * Opt-in only — requires RUN_STAGING_INTEGRATION_TESTS=1 plus real staging credentials. Never
 * runs during plain `npm test`/CI (no network calls, no secrets needed there). Run explicitly:
 *
 *   RUN_STAGING_INTEGRATION_TESTS=1 npx jest service.staging-integration
 *
 * Refuses outright against production, same guard as every scripts/staging/*.ts script.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

const ROOT = path.resolve(process.cwd());
function loadEnvFile(filename: string): boolean {
  const filepath = path.join(ROOT, filename);
  if (fs.existsSync(filepath)) {
    dotenv.config({ path: filepath });
    return true;
  }
  return false;
}
loadEnvFile('.env.staging.local');
loadEnvFile('.env.local');

const appEnv = process.env.NEXT_PUBLIC_APP_ENV ?? process.env.APP_ENV ?? '';
const shouldRun =
  process.env.RUN_STAGING_INTEGRATION_TESTS === '1' &&
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
  appEnv !== 'production';

if (process.env.RUN_STAGING_INTEGRATION_TESTS === '1' && appEnv === 'production') {
  throw new Error('[service.staging-integration] REFUSED: this test must never run against production.');
}

const maybeDescribe = shouldRun ? describe : describe.skip;

maybeDescribe('saveQuote — real staging integration (opt-in)', () => {
  jest.setTimeout(30000);

  it('saves a real Official (new-model) quote into the actual price_quotes schema without violating any NOT NULL constraint', async () => {
    // Enabling the flag here (rather than requiring it set on the machine running the test) is
    // deliberate — this test exists to validate the DB schema/insert path, not the flag-gating
    // logic (already covered by service.test.ts's mocked computeQuoteForJob tests).
    process.env.ENABLE_NEW_OFFICIAL_PRICING = 'true';

    const { getActivePricingVersion, computeQuoteForJob, saveQuote } = await import('../service');
    const { supabaseServer } = await import('@/lib/supabase/server');

    const version = await getActivePricingVersion();
    expect(version).not.toBeNull();
    if (!version) return;

    const input = {
      sourceLanguage: 'ru',
      targetLanguage: 'zh',
      serviceLevel: 'official_with_translator_signature_and_provider_stamp' as const,
      sourceCharacterCountWithSpaces: 1800,
      physicalPageCount: 1,
      applicantType: 'individual' as const,
      fulfillmentMethod: 'pickup' as const,
      deliveryRequired: false,
      salesChannel: 'direct' as const,
    };

    const computed = await computeQuoteForJob(input);
    if ('error' in computed) {
      throw new Error(`computeQuoteForJob failed — cannot exercise the real saveQuote insert: ${computed.error}`);
    }
    expect(computed.result.newModel).toBeDefined();

    const saved = await saveQuote(input, computed.result, computed.version);
    try {
      if ('error' in saved) {
        throw new Error(`saveQuote failed against the real staging schema: ${saved.error}`);
      }
      expect(saved.quoteId).toEqual(expect.any(String));

      // Re-fetch to confirm the row genuinely persisted with the expected null-but-legitimate
      // legacy fields, not just that .insert() didn't throw.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: row } = await (supabaseServer as any)
        .from('price_quotes')
        .select('included_word_count, included_page_count, amount_kzt, service_level')
        .eq('id', saved.quoteId)
        .maybeSingle();
      expect(row).not.toBeNull();
      expect(row.included_word_count).toBeNull();
      expect(row.included_page_count).toBeNull();
      expect(row.service_level).toBe('official_with_translator_signature_and_provider_stamp');
    } finally {
      if (!('error' in saved)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabaseServer as any).from('price_quote_items').delete().eq('quote_id', saved.quoteId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabaseServer as any).from('cost_reservations').delete().eq('quote_id', saved.quoteId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabaseServer as any).from('price_quotes').delete().eq('id', saved.quoteId);
      }
    }
  });
});
