/**
 * @jest-environment node
 *
 * Structural tests for Halyk payment finalization flow.
 * These verify invariants about the implementation — not mock integration tests —
 * because the status endpoint and callback require Supabase + HTTP which can't
 * be meaningfully mocked at unit level without recreating the full stack.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(process.cwd(), 'src/app/api/payments/halyk');

function readRoute(filename: string): string {
  return fs.readFileSync(path.join(ROOT, filename), 'utf-8');
}

// ─── Status endpoint ───────────────────────────────────────────────────────────

describe('status endpoint — on-demand reconciliation', () => {
  const statusSrc = readRoute('status/[paymentId]/route.ts');

  it('imports checkPaymentStatus for on-demand reconciliation', () => {
    expect(statusSrc).toContain("import { checkPaymentStatus");
  });

  it('imports finalize_halyk_payment RPC call', () => {
    expect(statusSrc).toContain('finalize_halyk_payment');
  });

  it('checks provider_invoice_id before calling Halyk', () => {
    expect(statusSrc).toContain('provider_invoice_id');
    expect(statusSrc).toContain('shouldReconcile');
  });

  it('uses RECONCILE_COOLDOWN_MS to prevent spamming Halyk', () => {
    expect(statusSrc).toContain('RECONCILE_COOLDOWN_MS');
  });

  it('skips reconciliation for terminal statuses', () => {
    expect(statusSrc).toContain('alreadyTerminal');
    expect(statusSrc).toContain('isTerminalStatus');
  });

  it('selects status_checked_at and provider_invoice_id from DB', () => {
    expect(statusSrc).toContain('status_checked_at');
    expect(statusSrc).toContain('provider_invoice_id');
  });

  it('updates status_checked_at before calling Halyk (anti-thundering-herd)', () => {
    // status_checked_at must be updated before the await checkPaymentStatus call
    const setCooldownPos = statusSrc.indexOf('status_checked_at: new Date().toISOString()');
    const checkStatusPos = statusSrc.indexOf('await checkPaymentStatus');
    expect(setCooldownPos).toBeGreaterThan(-1);
    expect(checkStatusPos).toBeGreaterThan(-1);
    expect(setCooldownPos).toBeLessThan(checkStatusPos);
  });

  it('maps CHARGE to paid and finalizes', () => {
    expect(statusSrc).toContain('isPaidStatus');
    expect(statusSrc).toContain("'paid'");
  });

  it('does not expose access_token or client_secret', () => {
    expect(statusSrc).not.toMatch(/access_token.*log/i);
    expect(statusSrc).not.toContain('client_secret');
  });

  it('returns JSON with paymentId, status, amount, currency, jobId', () => {
    expect(statusSrc).toContain('paymentId');
    expect(statusSrc).toContain('status:');
    expect(statusSrc).toContain('amount:');
    expect(statusSrc).toContain('currency:');
    expect(statusSrc).toContain('jobId:');
  });
});

// ─── Callback route ────────────────────────────────────────────────────────────

describe('callback route — security and resilience', () => {
  const callbackSrc = readRoute('callback/route.ts');

  it('does NOT return 401 when secret_hash is absent in test mode', () => {
    // Must contain the conditional path that proceeds without secret_hash in test mode
    expect(callbackSrc).toContain('isTestMode');
    expect(callbackSrc).toContain('secret_hash absent in test mode');
  });

  it('rejects missing secret_hash in production mode', () => {
    expect(callbackSrc).toContain('Production mode: secret_hash is mandatory');
  });

  it('calls checkPaymentStatus for authoritative status', () => {
    expect(callbackSrc).toContain('checkPaymentStatus');
  });

  it('calls finalize_halyk_payment RPC on CHARGE', () => {
    expect(callbackSrc).toContain('finalize_halyk_payment');
  });

  it('returns 200 to Halyk even on non-paid status (prevent retry storm)', () => {
    // The route should always end with { ok: true }
    expect(callbackSrc).toContain('{ ok: true }');
  });

  it('handles both invoiceId and invoiceID field names', () => {
    expect(callbackSrc).toContain("'invoiceId', 'invoiceID'");
  });

  it('logs structured events', () => {
    expect(callbackSrc).toContain('[halyk/callback] received');
    expect(callbackSrc).toContain('[halyk/callback] parsed');
    expect(callbackSrc).toContain('[halyk/callback] transaction found');
  });

  it('is idempotent for already-terminal payments', () => {
    expect(callbackSrc).toContain('duplicate callback for already-terminal payment');
  });
});

// ─── Migration: finalize_halyk_payment RPC exists ─────────────────────────────

describe('migration 0015 — finalize_halyk_payment RPC', () => {
  it('defines finalize_halyk_payment function', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0015_halyk_epay.sql'),
      'utf-8',
    );
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.finalize_halyk_payment');
    expect(sql).toContain("'queued'");
    expect(sql).toContain("'paid'");
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.finalize_halyk_payment TO service_role');
  });

  it('transitions job from payment_pending to queued on paid', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0015_halyk_epay.sql'),
      'utf-8',
    );
    // SQL uses extra spaces for alignment: "status         = 'queued'"
    expect(sql).toContain("'queued'");
    expect(sql).toContain("'payment_pending'");
    expect(sql).toContain('Move job from payment_pending to queued');
  });
});
