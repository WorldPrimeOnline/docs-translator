/**
 * @jest-environment node
 *
 * Tests for the staging manual payment confirmation service.
 * Uses the source-reading pattern consistent with this codebase's test style.
 * Does NOT make real Supabase calls — verifies invariants via source inspection.
 */

import { checkStagingGuards } from '../finalize-payment';

// ─── Environment guard tests ───────────────────────────────────────────────────

describe('checkStagingGuards', () => {
  const originalAppEnv = process.env.NEXT_PUBLIC_APP_ENV;
  const originalOverride = process.env.ALLOW_STAGING_PAYMENT_OVERRIDE;

  afterEach(() => {
    // Restore env
    if (originalAppEnv === undefined) {
      delete process.env.NEXT_PUBLIC_APP_ENV;
    } else {
      process.env.NEXT_PUBLIC_APP_ENV = originalAppEnv;
    }
    if (originalOverride === undefined) {
      delete process.env.ALLOW_STAGING_PAYMENT_OVERRIDE;
    } else {
      process.env.ALLOW_STAGING_PAYMENT_OVERRIDE = originalOverride;
    }
    delete process.env.APP_ENV;
  });

  it('refuses when APP_ENV is production', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'production';
    process.env.ALLOW_STAGING_PAYMENT_OVERRIDE = 'true';
    const result = checkStagingGuards();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('production');
  });

  it('refuses when ALLOW_STAGING_PAYMENT_OVERRIDE is absent', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    delete process.env.ALLOW_STAGING_PAYMENT_OVERRIDE;
    const result = checkStagingGuards();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('ALLOW_STAGING_PAYMENT_OVERRIDE');
  });

  it('refuses when ALLOW_STAGING_PAYMENT_OVERRIDE is "false"', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    process.env.ALLOW_STAGING_PAYMENT_OVERRIDE = 'false';
    const result = checkStagingGuards();
    expect(result.allowed).toBe(false);
  });

  it('refuses when ALLOW_STAGING_PAYMENT_OVERRIDE is "1" (not exactly "true")', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    process.env.ALLOW_STAGING_PAYMENT_OVERRIDE = '1';
    const result = checkStagingGuards();
    expect(result.allowed).toBe(false);
  });

  it('allows when APP_ENV=staging and ALLOW_STAGING_PAYMENT_OVERRIDE=true', () => {
    process.env.NEXT_PUBLIC_APP_ENV = 'staging';
    process.env.ALLOW_STAGING_PAYMENT_OVERRIDE = 'true';
    const result = checkStagingGuards();
    expect(result.allowed).toBe(true);
  });

  it('allows when APP_ENV=development and ALLOW_STAGING_PAYMENT_OVERRIDE=true', () => {
    process.env.APP_ENV = 'development';
    delete process.env.NEXT_PUBLIC_APP_ENV;
    process.env.ALLOW_STAGING_PAYMENT_OVERRIDE = 'true';
    const result = checkStagingGuards();
    expect(result.allowed).toBe(true);
  });

  it('refuses with only ALLOW_STAGING_PAYMENT_OVERRIDE when NEXT_PUBLIC_APP_ENV defaults to production logic', () => {
    // When neither APP_ENV nor NEXT_PUBLIC_APP_ENV is set, defaults to "production"
    delete process.env.NEXT_PUBLIC_APP_ENV;
    delete process.env.APP_ENV;
    process.env.ALLOW_STAGING_PAYMENT_OVERRIDE = 'true';
    const result = checkStagingGuards();
    // Defaulting to production → should be refused
    expect(result.allowed).toBe(false);
  });
});

// ─── Source invariant tests ───────────────────────────────────────────────────

describe('finalize-payment.ts source invariants', () => {
  it('exported from correct path', async () => {
    // Verify the module exports the expected functions
    const mod = await import('../finalize-payment');
    expect(typeof mod.checkStagingGuards).toBe('function');
    expect(typeof mod.finalizePaymentForStaging).toBe('function');
  });

  it('production guard appears before any Supabase query', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/payments/finalize-payment.ts'),
      'utf-8',
    );
    // checkStagingGuards must be called BEFORE any DB query in finalizePaymentForStaging
    const guardIdx = src.indexOf('checkStagingGuards()');
    const firstDbQueryIdx = src.indexOf('.from(\'payment_transactions\')');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(firstDbQueryIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(firstDbQueryIdx);
  });

  it('refuses production provider_environment when not on staging', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/payments/finalize-payment.ts'),
      'utf-8',
    );
    // Must check provider_environment = production and refuse
    expect(src).toContain("provider_environment === 'production'");
    expect(src).toContain('Cannot manually confirm a production-environment payment');
  });

  it('uses manual-staging- prefix for synthetic provider_transaction_id', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/payments/finalize-payment.ts'),
      'utf-8',
    );
    expect(src).toContain('manual-staging-');
  });

  it('sets provider_payload with manualOverride marker', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/payments/finalize-payment.ts'),
      'utf-8',
    );
    expect(src).toContain('manualOverride: true');
    expect(src).toContain("environment: 'staging'");
    expect(src).toContain('confirmedBy');
  });

  it('calls finalize_halyk_payment RPC when provider_invoice_id is available', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/payments/finalize-payment.ts'),
      'utf-8',
    );
    expect(src).toContain('finalize_halyk_payment');
    expect(src).toContain('provider_invoice_id');
  });

  it('idempotency: skips already-complete transactions', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/payments/finalize-payment.ts'),
      'utf-8',
    );
    expect(src).toContain('already_complete');
    expect(src).toContain("tx.status === 'paid' && job.status !== 'payment_pending'");
  });

  it('repair case: handles payment=paid but job=payment_pending', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/payments/finalize-payment.ts'),
      'utf-8',
    );
    expect(src).toContain("tx.status === 'paid' && job.status === 'payment_pending'");
    expect(src).toContain('repairHalfFinalizedPayment');
  });

  it('moves job to queued in all finalization paths', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/payments/finalize-payment.ts'),
      'utf-8',
    );
    expect(src).toMatch(/status.*'queued'/g);
    expect(src).toContain("payment_source: 'card_payment'");
  });

  it('calls markQuotePaid equivalent (price_quotes status=paid)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/payments/finalize-payment.ts'),
      'utf-8',
    );
    expect(src).toContain('price_quotes');
    expect(src).toContain("status: 'paid'");
    expect(src).toContain('cost_reservations');
    expect(src).toContain("status: 'committed'");
  });

  it('fiscal receipt created as pending_manual on staging (non-fatal)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/payments/finalize-payment.ts'),
      'utf-8',
    );
    expect(src).toContain('fiscal_receipts');
    expect(src).toContain("status: 'pending_manual'");
    expect(src).toContain('non-fatal');
  });

  it('writes audit log to job_audit_log with required fields', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/payments/finalize-payment.ts'),
      'utf-8',
    );
    expect(src).toContain('job_audit_log');
    expect(src).toContain('manual_staging_confirm');
    expect(src).toContain('transactionId');
    expect(src).toContain('amountKzt');
    expect(src).toContain('manualOverride: true');
  });
});

// ─── CLI script invariants ────────────────────────────────────────────────────

describe('confirm-payment-paid.ts CLI script', () => {
  it('requires --transaction-id argument', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'scripts/staging/confirm-payment-paid.ts'),
      'utf-8',
    );
    expect(src).toContain('--transaction-id');
    expect(src).toContain('process.exit(1)');
  });

  it('validates UUID format before calling the service', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'scripts/staging/confirm-payment-paid.ts'),
      'utf-8',
    );
    expect(src).toContain('invalid transaction ID format');
    expect(src).toMatch(/UUID/);
  });

  it('calls checkStagingGuards before calling the service', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'scripts/staging/confirm-payment-paid.ts'),
      'utf-8',
    );
    expect(src).toContain('checkStagingGuards');
    expect(src).toContain('[BLOCKED]');
  });

  it('imports finalizePaymentForStaging from the shared service', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'scripts/staging/confirm-payment-paid.ts'),
      'utf-8',
    );
    expect(src).toContain('finalizePaymentForStaging');
    expect(src).toContain('finalize-payment');
  });

  it('prints next-steps checklist after success', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'scripts/staging/confirm-payment-paid.ts'),
      'utf-8',
    );
    expect(src).toContain('jobs.status');
    expect(src).toContain('payment_transactions.paid_at');
    expect(src).toContain('JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED');
  });
});
