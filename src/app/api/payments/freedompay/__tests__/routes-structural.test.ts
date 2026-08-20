/**
 * @jest-environment node
 *
 * Structural tests for the Freedom Pay routes — same convention as
 * src/app/api/payments/halyk/__tests__/status-finalization.test.ts: these routes need
 * Supabase + HTTP, which can't be meaningfully mocked at unit level without
 * recreating the full stack, so we assert invariants against the actual source.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(process.cwd(), 'src/app/api/payments/freedompay');

function readRoute(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

describe('initiate route', () => {
  const src = readRoute('initiate/route.ts');

  it('does NOT import or check BUSINESS_PROFILE.cardPaymentsActive (Halyk-only gate)', () => {
    expect(src).not.toContain('BUSINESS_PROFILE');
    expect(src).not.toContain('cardPaymentsActive');
  });

  it('gates on FreedomPayConfig.enabled (FREEDOMPAY_ENABLED)', () => {
    expect(src).toContain('getFreedomPayConfig');
    expect(src).toContain('config.enabled');
  });

  it('reads the payable amount from verifyQuotePayable, never from the client', () => {
    expect(src).toContain('verifyQuotePayable(quoteId, jobId, user.id)');
    expect(src).not.toMatch(/priceKzt\s*=\s*(body|parsed\.data)\./);
  });

  it('creates the payment_transactions row before calling Freedom Pay', () => {
    const insertPos = src.indexOf(".from('payment_transactions')\n    .insert(");
    const initCallPos = src.indexOf('await initPayment(');
    expect(insertPos).toBeGreaterThan(-1);
    expect(initCallPos).toBeGreaterThan(-1);
    expect(insertPos).toBeLessThan(initCallPos);
  });

  it('uses the payment_transactions row id as both id and provider_invoice_id (pg_order_id)', () => {
    expect(src).toContain('id: paymentId');
    expect(src).toContain('provider_invoice_id: paymentId');
  });

  it('enforces a 10-minute idempotency window scoped to payment_provider=freedom_pay', () => {
    expect(src).toContain("eq('payment_provider', 'freedom_pay')");
    expect(src).toContain('PAYMENT_ALREADY_PENDING');
    expect(src).toContain('10 * 60 * 1000');
  });

  it('marks the transaction failed (not left pending) on init_payment failure', () => {
    expect(src).toContain("status: 'failed'");
  });

  it('success/failure URLs carry payment=<id>&provider=freedom_pay so /payment/result knows which status endpoint to poll', () => {
    // If this ever regresses, the browser return page silently defaults to the Halyk
    // status endpoint after a real Freedom Pay payment — see payment/result/page.tsx's
    // provider query param handling.
    expect(src).toContain('`${appBaseUrl}/payment/result?payment=${paymentId}&provider=freedom_pay`');
    // failureUrl must not silently diverge from successUrl (both need the same provider hint).
    const successPos = src.indexOf('const successUrl =');
    const failurePos = src.indexOf('const failureUrl =');
    expect(successPos).toBeGreaterThan(-1);
    expect(failurePos).toBeGreaterThan(successPos);
    expect(src).toContain('const failureUrl = successUrl;');
  });

  it('persists provider_transaction_id from initResult.pgPaymentId immediately after a successful init (2026-08-20 fix)', () => {
    expect(src).toContain('if (initResult.pgPaymentId)');
    expect(src).toContain('provider_transaction_id: initResult.pgPaymentId');
    // Must happen after the row exists and after init succeeded, before returning.
    const insertPos = src.indexOf(".from('payment_transactions')\n    .insert(");
    const persistPos = src.indexOf('provider_transaction_id: initResult.pgPaymentId');
    const returnPos = src.indexOf('return NextResponse.json({ paymentId, redirectUrl');
    expect(persistPos).toBeGreaterThan(insertPos);
    expect(persistPos).toBeLessThan(returnPos);
  });
});

describe('result route (Result URL webhook)', () => {
  const src = readRoute('result/route.ts');

  it('is public — no auth/session check', () => {
    expect(src).not.toContain('getAuthUser');
    expect(src).not.toContain('Unauthorized');
  });

  it('does NOT call any fiscalization function', () => {
    expect(src).not.toContain('ensureSaleFiscalReceiptForPaidPayment');
    expect(src).not.toContain('createRefundReceiptForRefund');
    expect(src).not.toContain('fiscal_receipts');
  });

  it('does NOT check BUSINESS_PROFILE.cardPaymentsActive', () => {
    expect(src).not.toContain('BUSINESS_PROFILE');
    expect(src).not.toContain('cardPaymentsActive');
  });

  it('verifies the inbound signature before doing anything with the payload', () => {
    const verifyPos = src.indexOf('verifySignature(');
    const rpcPos = src.indexOf("rpc('finalize_payment_transaction'");
    expect(verifyPos).toBeGreaterThan(-1);
    expect(rpcPos).toBeGreaterThan(-1);
    expect(verifyPos).toBeLessThan(rpcPos);
  });

  it('excludes pg_sig from the fields used to verify the signature', () => {
    expect(src).toContain('delete fieldsForVerification.pg_sig');
  });

  it('replays a stored ACK instead of recomputing salt/sig on a duplicate delivery', () => {
    expect(src).toContain('_wpo_response');
    expect(src).toContain('storedAck');
    // The replay branch must return before any RPC call.
    const replayPos = src.indexOf('if (storedAck)');
    const rpcPos = src.indexOf("rpc('finalize_payment_transaction'");
    expect(replayPos).toBeGreaterThan(-1);
    expect(replayPos).toBeLessThan(rpcPos);
  });

  it('never trusts pg_result=1 alone — confirms via checkStatus() before finalizing', () => {
    const mappedPaidPos = src.indexOf("mapped === 'paid'");
    const checkStatusPos = src.indexOf('await checkStatus(pgOrderId)');
    const rpcPos = src.indexOf("rpc('finalize_payment_transaction'");
    expect(mappedPaidPos).toBeGreaterThan(-1);
    expect(checkStatusPos).toBeGreaterThan(-1);
    expect(checkStatusPos).toBeLessThan(rpcPos);
  });

  it('calls the generic finalize_payment_transaction RPC, not finalize_halyk_payment', () => {
    expect(src).toContain("rpc('finalize_payment_transaction'");
    expect(src).not.toContain('finalize_halyk_payment');
  });

  it('validates amount and currency against the stored snapshot before finalizing', () => {
    expect(src).toContain('storedAmount');
    expect(src).toContain('requires_review');
  });

  it('reuses markQuotePaid and confirmReferral (provider-neutral, unchanged functions)', () => {
    expect(src).toContain('markQuotePaid(');
    expect(src).toContain('confirmReferral(');
  });

  it('always returns HTTP 200 with a signed XML body', () => {
    expect(src).toContain("'Content-Type': 'application/xml'");
    expect(src).toContain('status: 200');
  });

  it('confirms via mapFreedomPayPaymentStatus (Status API schema), not mapFreedomPayResult, when checking checkStatus()\'s response (2026-08-20 fix)', () => {
    expect(src).toContain('mapFreedomPayPaymentStatus(statusResp.pgPaymentStatus)');
    expect(src).not.toContain('mapFreedomPayResult(statusResp');
  });

  it('marks the payment failed if the Status API confirms error, even though the callback said pg_result=1', () => {
    expect(src).toContain("providerMapped === 'failed'");
    expect(src).toContain("status: 'failed', failed_at: now");
  });

  it('persists provider_transaction_id/provider_status/provider_reason breadcrumb on every successful status check, not only on the paid path', () => {
    expect(src).toContain('breadcrumb.provider_transaction_id = statusResp.pgPaymentId');
    expect(src).toContain('breadcrumb.provider_status = statusResp.pgPaymentStatus');
    expect(src).toContain('breadcrumb.provider_reason');
  });
});

describe('status route (frontend polling)', () => {
  const src = readRoute('status/[paymentId]/route.ts');

  it('requires an authenticated, owning user', () => {
    expect(src).toContain('getAuthUser');
    expect(src).toContain('Unauthorized');
    expect(src).toContain('paymentTx.user_id !== user.id');
  });

  it('does NOT call any fiscalization function', () => {
    expect(src).not.toContain('ensureSaleFiscalReceiptForPaidPayment');
    expect(src).not.toContain('fiscal_receipts');
  });

  it('gates on-demand reconciliation with a cooldown to avoid hammering Freedom Pay', () => {
    expect(src).toContain('RECONCILE_COOLDOWN_MS');
    expect(src).toContain('shouldReconcile');
  });

  it('calls the generic finalize_payment_transaction RPC, not finalize_halyk_payment', () => {
    expect(src).toContain("rpc('finalize_payment_transaction'");
    expect(src).not.toContain('finalize_halyk_payment');
  });

  it('scopes its lookup to payment_provider=freedom_pay', () => {
    expect(src).toContain("eq('payment_provider', 'freedom_pay')");
  });

  it('maps get_status3.php via mapFreedomPayPaymentStatus (pg_payment_status), not mapFreedomPayResult (pg_result) — the 2026-08-20 infinite-spinner root cause', () => {
    expect(src).toContain('mapFreedomPayPaymentStatus');
    expect(src).not.toContain('mapFreedomPayResult');
    expect(src).toContain('mapFreedomPayPaymentStatus(statusResp.pgPaymentStatus)');
  });

  it('marks the payment locally failed when the Status API reports error, and never touches jobs.status for that transition', () => {
    const failedBranchPos = src.indexOf("mapped === 'failed'");
    expect(failedBranchPos).toBeGreaterThan(-1);
    const branchSlice = src.slice(failedBranchPos, failedBranchPos + 600);
    expect(branchSlice).toContain("status: 'failed', failed_at: now");
    expect(branchSlice).not.toContain(".from('jobs')");
  });

  it('persists provider_transaction_id/provider_status/provider_reason breadcrumb on every successful status check, including non-terminal pending/unknown outcomes', () => {
    expect(src).toContain('breadcrumb.provider_transaction_id = statusResp.pgPaymentId');
    expect(src).toContain('breadcrumb.provider_status = statusResp.pgPaymentStatus');
    expect(src).toContain('breadcrumb.provider_reason');
    // The pending/unknown branch must still write the breadcrumb, not skip persistence.
    expect(src).toContain("if (mapped === 'unknown')");
  });

  it('treats an unrecognized pg_payment_status as pending, never as paid', () => {
    // mapFreedomPayPaymentStatus itself already guarantees this (tested in
    // status-map.test.ts) — this asserts the route doesn't add its own separate
    // 'unknown -> paid' branch anywhere.
    expect(src).not.toMatch(/mapped === 'unknown'[\s\S]*?currentStatus = 'paid'/);
  });
});

describe('cross-route consistency', () => {
  it('the migration adds finalize_payment_transaction without defining/altering finalize_halyk_payment', () => {
    const migrationPath = path.join(process.cwd(), 'supabase/migrations/0070_finalize_payment_transaction_rpc.sql');
    const migrationSrc = fs.readFileSync(migrationPath, 'utf-8');
    expect(migrationSrc).toContain('CREATE OR REPLACE FUNCTION public.finalize_payment_transaction');
    expect(migrationSrc).toContain('GRANT EXECUTE ON FUNCTION public.finalize_payment_transaction TO service_role');
    // finalize_halyk_payment may be mentioned in prose/comments explaining rationale,
    // but must never appear as a CREATE/ALTER/DROP target — this migration must not
    // define or modify it.
    expect(migrationSrc).not.toMatch(/(CREATE|ALTER|DROP)[^;]*finalize_halyk_payment/i);
  });

  it('the pre-existing finalize_halyk_payment migration (0015) is untouched by this integration', () => {
    const migrationPath = path.join(process.cwd(), 'supabase/migrations/0015_halyk_epay.sql');
    const migrationSrc = fs.readFileSync(migrationPath, 'utf-8');
    expect(migrationSrc).toContain('CREATE OR REPLACE FUNCTION public.finalize_halyk_payment');
  });

  it('/payment/result reads the provider query param and polls the matching status endpoint', () => {
    const pagePath = path.join(process.cwd(), 'src/app/[locale]/payment/result/page.tsx');
    const pageSrc = fs.readFileSync(pagePath, 'utf-8');
    expect(pageSrc).toContain("searchParams.get('provider') === 'freedom_pay' ? 'freedompay' : 'halyk'");
    expect(pageSrc).toContain('/api/payments/${provider}/status/');
    // Absent provider param must still resolve to Halyk — existing Halyk backLinks
    // never include it, so their behavior must stay unchanged.
    expect(pageSrc).toMatch(/const provider = searchParams\.get\('provider'\)[^;]*: 'halyk'/);
  });

  it('CheckoutClient switches between FreedomPayButton and HalykPayButton via getCheckoutPaymentProvider(), and never renders the staging bypass button', () => {
    const checkoutPath = path.join(process.cwd(), 'src/components/order/CheckoutClient.tsx');
    const checkoutSrc = fs.readFileSync(checkoutPath, 'utf-8');
    expect(checkoutSrc).toContain('getCheckoutPaymentProvider');
    expect(checkoutSrc).toContain('FreedomPayButton');
    expect(checkoutSrc).toContain('HalykPayButton');
    expect(checkoutSrc).not.toContain('StagingPaymentBypassButton');
  });

  it('dashboard "pay now" card switches between FreedomPayButton and HalykPayButton, and never renders the staging bypass button', () => {
    const dashboardPath = path.join(process.cwd(), 'src/app/[locale]/dashboard/page.tsx');
    const dashboardSrc = fs.readFileSync(dashboardPath, 'utf-8');
    expect(dashboardSrc).toContain('getCheckoutPaymentProvider');
    expect(dashboardSrc).toContain('FreedomPayButton');
    expect(dashboardSrc).toContain('HalykPayButton');
    expect(dashboardSrc).not.toContain('StagingPaymentBypassButton');
  });

  it('the staging payment bypass mechanism itself is untouched — route, service, and CLI script still exist and are unmodified by this checkout switch', () => {
    const bypassRoutePath = path.join(process.cwd(), 'src/app/api/payments/staging-bypass/route.ts');
    const bypassServicePath = path.join(process.cwd(), 'src/lib/payments/staging-bypass.ts');
    const bypassScriptPath = path.join(process.cwd(), 'scripts/staging/confirm-payment-paid.ts');
    expect(fs.existsSync(bypassRoutePath)).toBe(true);
    expect(fs.existsSync(bypassServicePath)).toBe(true);
    expect(fs.existsSync(bypassScriptPath)).toBe(true);
    const bypassSrc = fs.readFileSync(bypassServicePath, 'utf-8');
    expect(bypassSrc).toContain('isStagingBypassEnabled');
    expect(bypassSrc).toContain('verifyStagingBypassPassword');
  });
});
