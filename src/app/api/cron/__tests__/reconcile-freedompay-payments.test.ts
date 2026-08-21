/**
 * @jest-environment node
 *
 * Structural tests for the reconcile-freedompay-payments cron route — same convention
 * as reconcile-refunds.test.ts and the Halyk reconcile-payments route: Supabase +
 * Freedom Pay HTTP can't be meaningfully mocked at unit level without recreating the
 * full stack, so we assert invariants against the actual source.
 *
 * Added 2026-08-21 as the server-side fallback for the "client paid → closed browser →
 * Result callback never arrived" scenario — see docs/ai-context/DECISIONS.md.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROUTE_PATH = path.join(process.cwd(), 'src/app/api/cron/reconcile-freedompay-payments/route.ts');
const src = fs.readFileSync(ROUTE_PATH, 'utf-8');

const HALYK_ROUTE_PATH = path.join(process.cwd(), 'src/app/api/cron/reconcile-payments/route.ts');
const halykSrc = fs.readFileSync(HALYK_ROUTE_PATH, 'utf-8');

describe('reconcile-freedompay-payments — CRON_SECRET auth', () => {
  it('authenticates with Bearer CRON_SECRET', () => {
    expect(src).toContain('CRON_SECRET');
    expect(src).toContain('Bearer');
    expect(src).toContain('status: 401');
  });

  it('exports GET handler', () => {
    expect(src).toContain('export async function GET');
  });
});

describe('reconcile-freedompay-payments — does not touch the Halyk cron', () => {
  it('is a separate route file from reconcile-payments', () => {
    expect(ROUTE_PATH).not.toBe(HALYK_ROUTE_PATH);
  });

  it('the Halyk reconcile-payments route is unmodified — still Halyk-only, still calls finalize_halyk_payment', () => {
    expect(halykSrc).toContain("eq('payment_provider', 'halyk_epay')");
    expect(halykSrc).toContain("rpc('finalize_halyk_payment'");
    expect(halykSrc).not.toContain('freedom_pay');
  });

  it('reconcile-freedompay-payments never calls finalize_halyk_payment', () => {
    expect(src).not.toContain('finalize_halyk_payment');
  });
});

describe('reconcile-freedompay-payments — targeting and status handling', () => {
  it('only selects payment_provider=freedom_pay rows', () => {
    expect(src).toContain(".eq('payment_provider', 'freedom_pay')");
  });

  it('only reconciles non-terminal statuses (payment_pending, requires_review)', () => {
    expect(src).toContain("'payment_pending', 'requires_review'");
  });

  it('calls Freedom Pay checkStatus() (get_status3.php), not the Result callback mapper', () => {
    expect(src).toContain('import { checkStatus }');
    expect(src).toContain('await checkStatus(tx.provider_invoice_id)');
    expect(src).toContain('mapFreedomPayPaymentStatus');
  });

  it('success (mapped paid) calls the shared finalize_payment_transaction RPC', () => {
    const successPos = src.indexOf("mapped === 'paid'");
    const rpcPos = src.indexOf("rpc('finalize_payment_transaction'");
    expect(successPos).toBeGreaterThan(-1);
    expect(rpcPos).toBeGreaterThan(successPos);
  });

  it('error (mapped failed) marks the transaction failed, without calling the RPC', () => {
    const failedBranchPos = src.indexOf("mapped === 'failed'");
    expect(failedBranchPos).toBeGreaterThan(-1);
    const branchSlice = src.slice(failedBranchPos, failedBranchPos + 300);
    expect(branchSlice).toContain("status: 'failed', failed_at: checkedAt");
  });

  it('pending/unknown leaves payment_transactions.status unchanged (breadcrumb-only write)', () => {
    expect(src).toContain('stillPending++');
    // The pending/unknown branch must not contain its own status: update.
    const elseBranchPos = src.lastIndexOf('} else {');
    const elseBranchSlice = src.slice(elseBranchPos, elseBranchPos + 400);
    expect(elseBranchSlice).not.toMatch(/\.update\(\{\s*status:/);
  });

  it('persists status_checked_at breadcrumb unconditionally before branching on mapped outcome', () => {
    const breadcrumbBuildPos = src.indexOf('const breadcrumb: Record<string, unknown> = { status_checked_at: checkedAt, updated_at: checkedAt };');
    const breadcrumbWritePos = src.indexOf(
      "await (supabaseServer as any).from('payment_transactions').update(breadcrumb).eq('id', tx.id);",
    );
    const mappedPos = src.indexOf('const mapped = mapFreedomPayPaymentStatus');
    expect(breadcrumbBuildPos).toBeGreaterThan(-1);
    expect(breadcrumbWritePos).toBeGreaterThan(breadcrumbBuildPos);
    expect(breadcrumbWritePos).toBeLessThan(mappedPos);
  });

  it('never writes callback_received_at — this cron is not a Result URL delivery', () => {
    expect(src).not.toContain('callback_received_at');
  });
});

describe('reconcile-freedompay-payments — idempotency and duplicate protection', () => {
  it('relies on the finalize_payment_transaction RPC for idempotency (row lock + status=paid guard), not its own logic', () => {
    expect(src).toContain('rpcData?.duplicate_charge');
    expect(src).toContain('rpcData?.ok');
    // No separate "already paid" short-circuit query before the RPC call — the RPC
    // itself is the single source of truth for idempotency (see migration 0071).
    expect(src).not.toMatch(/\.eq\('status', 'paid'\)[\s\S]{0,120}\.maybeSingle\(\)/);
  });

  it('alerts the operator via Telegram on a detected duplicate charge', () => {
    expect(src).toContain('notifyOperatorPaymentAlert');
    expect(src).toContain('DUPLICATE CHARGE');
  });

  it('reuses markQuotePaid and confirmReferral on a genuine (non-duplicate) success, mirroring the result/status routes', () => {
    expect(src).toContain('markQuotePaid(');
    expect(src).toContain('confirmReferral(');
    const okBranchPos = src.indexOf('} else if (rpcData?.ok)');
    const markQuotePos = src.indexOf('markQuotePaid(quoteId, tx.id)');
    expect(markQuotePos).toBeGreaterThan(okBranchPos);
  });
});

describe('reconcile-freedompay-payments — batching, age window, no fiscalization', () => {
  it('limits batch size to prevent timeout (BATCH_LIMIT)', () => {
    expect(src).toContain('BATCH_LIMIT');
    expect(src).toContain('.limit(BATCH_LIMIT)');
  });

  it('skips brand-new attempts (MIN_AGE_MINUTES) and stops after MAX_AGE_HOURS', () => {
    expect(src).toContain('MIN_AGE_MINUTES');
    expect(src).toContain('MAX_AGE_HOURS');
  });

  it('does not call any fiscalization function — Freedom Pay is explicitly out of fiscal scope', () => {
    expect(src).not.toContain('ensureSaleFiscalReceiptForPaidPayment');
    expect(src).not.toContain('fiscal_receipts');
  });

  it('gates on FreedomPayConfig.enabled, not the Halyk config', () => {
    expect(src).toContain('getFreedomPayConfig');
    expect(src).not.toContain('getHalykConfig');
  });
});
