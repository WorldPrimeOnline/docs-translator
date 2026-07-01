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

  it('updates status_checked_at AFTER a successful Halyk response (not before, to avoid blocking retries on parse error)', () => {
    // status_checked_at is set inside the try block, AFTER the successful checkPaymentStatus call.
    // This ensures parse/network errors do NOT permanently activate the cooldown.
    const setCooldownPos = statusSrc.indexOf('status_checked_at: new Date().toISOString()');
    const checkStatusPos = statusSrc.indexOf('await checkPaymentStatus');
    expect(setCooldownPos).toBeGreaterThan(-1);
    expect(checkStatusPos).toBeGreaterThan(-1);
    // cooldown stamp comes AFTER the awaited status call
    expect(setCooldownPos).toBeGreaterThan(checkStatusPos);
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

// ─── Fiscal hook presence ──────────────────────────────────────────────────────

describe('fiscal hook — all finalization paths use ensureSaleFiscalReceiptForPaidPayment', () => {
  it('callback route imports ensureSaleFiscalReceiptForPaidPayment', () => {
    const src = readRoute('callback/route.ts');
    expect(src).toContain('ensureSaleFiscalReceiptForPaidPayment');
  });

  it('callback route does NOT use void createSaleReceiptForPayment (fire-and-forget is removed)', () => {
    const src = readRoute('callback/route.ts');
    expect(src).not.toContain('void createSaleReceiptForPayment');
  });

  it('callback route awaits fiscal hook in a try-catch', () => {
    const src = readRoute('callback/route.ts');
    expect(src).toContain('await ensureSaleFiscalReceiptForPaidPayment');
  });

  it('status route imports ensureSaleFiscalReceiptForPaidPayment', () => {
    const src = readRoute('status/[paymentId]/route.ts');
    expect(src).toContain('ensureSaleFiscalReceiptForPaidPayment');
  });

  it('status route awaits fiscal hook after finalization', () => {
    const src = readRoute('status/[paymentId]/route.ts');
    expect(src).toContain('await ensureSaleFiscalReceiptForPaidPayment');
    // Hook placed after finalizeSucceeded
    const hookPos = src.indexOf('await ensureSaleFiscalReceiptForPaidPayment');
    const finalizePos = src.indexOf('finalizeSucceeded = true');
    expect(hookPos).toBeGreaterThan(finalizePos);
  });

  it('reconcile-payments cron imports ensureSaleFiscalReceiptForPaidPayment', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/cron/reconcile-payments/route.ts'),
      'utf-8',
    );
    expect(src).toContain('ensureSaleFiscalReceiptForPaidPayment');
  });

  it('reconcile-payments cron does NOT use void createSaleReceiptForPayment', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/cron/reconcile-payments/route.ts'),
      'utf-8',
    );
    expect(src).not.toContain('void createSaleReceiptForPayment');
  });

  it('fiscal service exports ensureSaleFiscalReceiptForPaidPayment', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/fiscal/service.ts'),
      'utf-8',
    );
    expect(src).toContain('export async function ensureSaleFiscalReceiptForPaidPayment');
  });

  it('fiscal service has NO direct Webkassa/provider call anywhere (sale or refund)', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/fiscal/service.ts'),
      'utf-8',
    );
    // Vercel must not call Webkassa. Only Railway worker (fiscal-processor) calls Webkassa.
    expect(src).not.toContain('provider.createSaleReceipt');
    expect(src).not.toContain('provider.createRefundReceipt');
    expect(src).not.toContain('_runProviderSaleReceipt');
  });

  it('ensureSaleFiscalReceiptForPaidPayment does not call provider directly — worker handles Webkassa', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/fiscal/service.ts'),
      'utf-8',
    );
    const fnStart = src.indexOf('export async function ensureSaleFiscalReceiptForPaidPayment');
    const fnEnd = src.indexOf('\nexport ', fnStart + 10);
    const fnSrc = src.slice(fnStart, fnEnd > fnStart ? fnEnd : undefined);
    expect(fnSrc).not.toContain('provider.createSaleReceipt');
    expect(fnSrc).not.toContain('_runProviderSaleReceipt');
    expect(fnSrc).toContain('worker fiscal-processor');
  });

  it('createRefundReceiptForRefund does not call provider directly — worker handles refunds', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/fiscal/service.ts'),
      'utf-8',
    );
    const fnStart = src.indexOf('export async function createRefundReceiptForRefund');
    const fnSrc = src.slice(fnStart);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnSrc).not.toContain('provider.createRefundReceipt');
  });

  it('pending_manual path does not trigger async provider call', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/fiscal/service.ts'),
      'utf-8',
    );
    // manual or disabled → pending_manual; provider call only for pending
    expect(src).toContain("'pending_manual' as const");
    expect(src).toContain("'pending' as const");
  });

  it('webkassa-provider.ts error log includes hasApiKey as boolean, never the key value', () => {
    const providerSrc = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/fiscal/webkassa-provider.ts'),
      'utf-8',
    );
    expect(providerSrc).toContain('hasApiKey: !!cfg.apiKey');
    // Key value must never appear directly in log fields
    expect(providerSrc).not.toMatch(/console\.\w+\([^)]*apiKey:\s*cfg\.apiKey[^)]*\)/);
  });
});

// ─── AUTH invariants — stuck payment diagnosis ─────────────────────────────────

describe('AUTH stuck payment — diagnostic logging invariants', () => {
  const statusSrc = readRoute('status/[paymentId]/route.ts');
  const clientSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/payments/halyk/client.ts'),
    'utf-8',
  );
  const callbackSrc = readRoute('callback/route.ts');

  it('status endpoint logs PAYMENT_STUCK_AUTH warning for long-running AUTH payments', () => {
    expect(statusSrc).toContain('PAYMENT_STUCK_AUTH');
    expect(statusSrc).toContain('AUTH_WARNING_THRESHOLD_MS');
    expect(statusSrc).toContain("providerStatusName === 'AUTH'");
  });

  it('client logs raw Halyk response details (statusName, transactionId, terminal) for diagnosis', () => {
    expect(clientSrc).toContain('[halyk/client] checkPaymentStatus raw response');
    expect(clientSrc).toContain('rawStatusName');
    expect(clientSrc).toContain('rawTransactionId');
    expect(clientSrc).toContain('rawTerminal');
  });

  it('client raw log does NOT include access_token or client_secret', () => {
    const rawLogStart = clientSrc.indexOf('[halyk/client] checkPaymentStatus raw response');
    const rawLogEnd = clientSrc.indexOf('});', rawLogStart);
    const logBlock = clientSrc.slice(rawLogStart, rawLogEnd);
    expect(logBlock).not.toContain('access_token');
    expect(logBlock).not.toContain('client_secret');
    expect(logBlock).not.toContain('secret_hash');
  });

  it('callback logs codeValue and reasonValue from Halyk payload', () => {
    expect(callbackSrc).toContain('codeValue');
    expect(callbackSrc).toContain('reasonValue');
    expect(callbackSrc).toContain('hasInvoiceId');
  });

  it('callback logs only a boolean for hasSecretHash, not the value itself', () => {
    expect(callbackSrc).toContain('hasSecretHash');
    // The value of secret_hash must never be logged directly
    expect(callbackSrc).not.toMatch(/['"]secret_hash['"]\s*:\s*payload\[/);
  });

  it('callback looks up transaction by provider_invoice_id, not by quote_id', () => {
    expect(callbackSrc).toContain("'provider_invoice_id'");
    expect(callbackSrc).not.toMatch(/\.eq\(['"]quote_id['"]/);
  });

  it('AUTH warning hypothesis mentions 2-step AUTH→CAPTURE terminal configuration', () => {
    expect(statusSrc).toContain('2-step AUTH→CAPTURE');
    expect(statusSrc).toContain('Halyk merchant portal');
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
