/**
 * @jest-environment node
 *
 * Structural tests for the staging payment bypass route — same source-inspection
 * convention as src/app/api/payments/halyk/__tests__/entity-gate.test.ts, since
 * Supabase/Next request/response plumbing isn't meaningfully mockable at unit level
 * for this route.
 */

import * as fs from 'fs';
import * as path from 'path';

const routeSrc = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/payments/staging-bypass/route.ts'),
  'utf-8',
);

describe('staging-bypass route — production/enablement gate', () => {
  it('checks isStagingBypassEnabled() before parsing the request body', () => {
    const gateIndex = routeSrc.indexOf('isStagingBypassEnabled()');
    const bodyParseIndex = routeSrc.indexOf('await handlePost(');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(bodyParseIndex);
  });

  it('returns 404 (not 403) when the gate fails — indistinguishable from a missing route', () => {
    expect(routeSrc).toContain('function notFound(): NextResponse {\n  return new NextResponse(null, { status: 404 });');
  });

  it('GET is not implemented (also 404)', () => {
    expect(routeSrc).toContain('export async function GET(): Promise<NextResponse> {\n  return notFound();');
  });
});

describe('staging-bypass route — password handling', () => {
  it('verifies the password via the constant-time helper, not a direct comparison', () => {
    expect(routeSrc).toContain('verifyStagingBypassPassword(password)');
    expect(routeSrc).not.toMatch(/password\s*===/);
    expect(routeSrc).not.toMatch(/password\s*==\s*process\.env/);
  });

  it('never logs the password value', () => {
    // Strip quoted string contents first (offset-preserving) so the English word
    // "password" inside a log message like 'invalid password attempt' doesn't
    // false-positive — this only flags the bare `password` identifier being passed
    // as an actual argument/property to a console.* call.
    const stripped = routeSrc.replace(
      /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g,
      (m) => ' '.repeat(m.length),
    );
    const logCalls = stripped.match(/console\.\w+\([^;]*\);/g) ?? [];
    for (const call of logCalls) {
      expect(call).not.toMatch(/\bpassword\b/);
    }
  });

  it('never echoes the password value or env secret back in a response body', () => {
    // Case-sensitive and \b-bounded so the INVALID_PASSWORD error *code* (a constant,
    // not the secret itself) doesn't false-positive this check.
    expect(routeSrc).not.toMatch(/NextResponse\.json\(\{[^}]*\bpassword\b/);
    expect(routeSrc).not.toContain('STAGING_PAYMENT_BYPASS_PASSWORD');
  });
});

describe('staging-bypass route — never trusts a client-supplied price', () => {
  it('re-derives the amount via verifyQuotePayable, like /api/payments/halyk/initiate does', () => {
    expect(routeSrc).toContain("import { verifyQuotePayable } from '@/lib/pricing/service';");
    expect(routeSrc).toContain('verifyQuotePayable(quoteId, jobId, user.id)');
  });

  it('the request schema has no priceKzt/amount field', () => {
    const schemaMatch = routeSrc.match(/const RequestSchema = z\.object\(\{[\s\S]*?\}\);/);
    expect(schemaMatch).not.toBeNull();
    expect(schemaMatch![0]).not.toMatch(/price|amount/i);
  });
});

describe('staging-bypass route — reuses the shared finalize function, no duplicated downstream logic', () => {
  it('imports finalizePaymentForStaging instead of reimplementing payment finalization', () => {
    expect(routeSrc).toContain("import { finalizePaymentForStaging } from '@/lib/payments/finalize-payment';");
    expect(routeSrc).toContain('finalizePaymentForStaging(transactionId');
  });

  it('does not call the finalize_halyk_payment RPC directly (that belongs to finalize-payment.ts)', () => {
    expect(routeSrc).not.toContain("rpc('finalize_halyk_payment'");
  });
});

describe('staging-bypass route — idempotency', () => {
  it('looks up the most recent payment_transactions row for the job before creating a new one', () => {
    expect(routeSrc).toContain("from('payment_transactions')");
    expect(routeSrc).toMatch(/existingTx[\s\S]*status === 'paid'/);
  });

  it('reuses an existing paid transaction id rather than creating a duplicate', () => {
    expect(routeSrc).toMatch(/existingTx\.status === 'paid'[\s\S]{0,400}transactionId = existingTx\.id/);
  });

  it('reuses an existing payment_pending transaction id rather than creating a duplicate', () => {
    expect(routeSrc).toMatch(/existingTx\.status === 'payment_pending'[\s\S]{0,400}transactionId = existingTx\.id/);
  });

  it('refuses (409) when the job is not payable and there is no paid transaction to reconcile', () => {
    expect(routeSrc).toContain('JOB_NOT_PAYABLE');
    expect(routeSrc).toContain("status: 409");
  });
});

describe('staging-bypass route — created transactions are clearly distinguishable from real Halyk charges', () => {
  it('tags bypass-created rows with a non-halyk payment_provider', () => {
    expect(routeSrc).toContain("payment_provider: 'staging_bypass'");
  });

  it('marks the environment and source in pricing_snapshot_json/provider_environment', () => {
    expect(routeSrc).toContain("provider_environment: 'test'");
    expect(routeSrc).toContain('staging_payment_bypass');
  });

  it('never sets jobs.payment_source to anything outside the DB CHECK constraint (card_payment | subscription | null)', () => {
    expect(routeSrc).toContain("payment_source: 'card_payment'");
  });
});

describe('staging-bypass route — created payment_transactions row satisfies the DB schema', () => {
  // Regression test for: "null value in column expires_at ... violates not-null
  // constraint". Derives the required (non-optional) Insert fields directly from the
  // generated Supabase types (the schema source of truth) instead of a hand-maintained
  // list, so this catches ANY future NOT NULL column the insert forgets to set —
  // not just expires_at.
  const typesSrc = fs.readFileSync(path.join(process.cwd(), 'src/types/supabase.ts'), 'utf-8');

  /** Extracts the substring between the `{` right after `marker` and its matching `}`. */
  function extractBracedBlock(src: string, marker: string): string {
    const markerIdx = src.indexOf(marker);
    if (markerIdx === -1) throw new Error(`marker not found: ${marker}`);
    const braceStart = src.indexOf('{', markerIdx);
    let depth = 0;
    for (let i = braceStart; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) return src.slice(braceStart + 1, i);
      }
    }
    throw new Error(`unbalanced braces for marker: ${marker}`);
  }

  function requiredInsertFields(table: string): string[] {
    const tableBlock = extractBracedBlock(typesSrc, `${table}: {`);
    const insertBlock = extractBracedBlock(tableBlock, 'Insert: {');
    return insertBlock
      .split('\n')
      .map((line) => line.trim())
      .map((line) => /^(\w+)(\??):/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null && m[2] !== '?')
      // Group 1 is mandatory in this pattern — it's always present when the match succeeds.
      .map((m) => m[1]!);
  }

  function insertedFields(): string[] {
    const insertBlock = extractBracedBlock(routeSrc, '.insert({');
    return insertBlock
      .split('\n')
      .map((line) => line.trim())
      .map((line) => /^(\w+):/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1]!);
  }

  it('sanity check: the schema currently requires user_id, document_id, job_id, amount, expires_at', () => {
    // If this fails, the generated types changed — re-derive, don't hardcode around it.
    expect(requiredInsertFields('payment_transactions').sort()).toEqual(
      ['user_id', 'document_id', 'job_id', 'amount', 'expires_at'].sort(),
    );
  });

  it('sets every NOT NULL-without-default payment_transactions column on insert', () => {
    const required = requiredInsertFields('payment_transactions');
    const inserted = insertedFields();
    for (const field of required) {
      expect(inserted).toContain(field);
    }
  });

  it('specifically sets expires_at (regression: was previously missing)', () => {
    expect(insertedFields()).toContain('expires_at');
  });

  it('computes expires_at with the same 30-minute window as /api/payments/halyk/initiate', () => {
    expect(routeSrc).toContain("new Date(Date.now() + 30 * 60 * 1000).toISOString()");
  });
});
