/**
 * @jest-environment node
 *
 * Tests for the worker's payment eligibility check.
 * Verifies the mismatch between legacy 'completed' (TON-era) and
 * current 'paid' (Halyk ePay) payment_transaction statuses is handled.
 */

// Read the source to assert the eligibility logic is correct
describe('worker isEligible — payment_transactions status check', () => {
  it('worker/src/index.ts checks for paid status (not only completed)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'worker/src/index.ts'),
      'utf-8',
    );

    // Must include 'paid' in the eligibility check
    expect(src).toContain("'paid'");
    // Must use .in() or otherwise include both values
    expect(src).toMatch(/\.in\(.*'paid'.*'completed'|'paid'.*'completed'.*\.in\(/s);
    // Must NOT use a bare .eq('status', 'completed') for payment_transactions
    expect(src).not.toMatch(/payment_transactions[\s\S]{0,300}\.eq\('status',\s*'completed'\)/);
  });

  it('worker/src/index.ts includes card_payment in startup eligibility config', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'worker/src/index.ts'),
      'utf-8',
    );
    expect(src).toContain('card_payment');
    expect(src).toContain('cardPaymentJobsRequireConfirmedPayment');
  });

  it('finalize_halyk_payment migration sets jobs.status to queued', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0015_halyk_epay.sql'),
      'utf-8',
    );
    // The RPC should move job to 'queued' (worker-selectable)
    expect(sql).toContain("status         = 'queued'");
    expect(sql).toContain("AND status = 'payment_pending'");
  });

  it('finalize_halyk_payment migration sets payment_transactions.status to paid', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0015_halyk_epay.sql'),
      'utf-8',
    );
    // The RPC should set payment to 'paid' (Halyk-era status)
    expect(sql).toContain("status                 = 'paid'");
  });

  it('payment_transactions status constraint includes paid', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0015_halyk_epay.sql'),
      'utf-8',
    );
    expect(sql).toContain("'paid'");
    expect(sql).toMatch(/payment_transactions_status_check[\s\S]{0,300}'paid'/);
  });
});
