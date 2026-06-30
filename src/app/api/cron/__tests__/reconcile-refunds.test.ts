/**
 * @jest-environment node
 *
 * Structural tests for the reconcile-refunds cron route.
 * Verifies safety invariants without mocking Supabase/Halyk.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROUTE_PATH = path.join(process.cwd(), 'src/app/api/cron/reconcile-refunds/route.ts');
const src = fs.readFileSync(ROUTE_PATH, 'utf-8');

describe('reconcile-refunds — CRON_SECRET auth', () => {
  it('authenticates with Bearer CRON_SECRET', () => {
    expect(src).toContain('CRON_SECRET');
    expect(src).toContain('Bearer');
    expect(src).toContain("status: 401");
  });

  it('exports GET handler', () => {
    expect(src).toContain('export async function GET');
  });
});

describe('reconcile-refunds — safety invariants', () => {
  it('only queries status=paid rows (never queries refunded, pending, etc.)', () => {
    expect(src).toContain(".eq('status', 'paid')");
    expect(src).not.toContain(".eq('status', 'refunded')");
  });

  it('only processes rows with no refunded_at (prevents double reconciliation)', () => {
    expect(src).toContain(".is('refunded_at', null)");
  });

  it('only updates payment_transactions if still paid (guard against concurrent reconciliation)', () => {
    expect(src).toContain(".eq('status', 'paid')");
    // The update call includes a guard
    const updateIdx = src.lastIndexOf(".eq('status', 'paid')");
    expect(updateIdx).toBeGreaterThan(-1);
  });

  it('uses idempotency_key to prevent duplicate refund_transactions rows', () => {
    expect(src).toContain('idempotency_key');
    expect(src).toContain('ignoreDuplicates: true');
  });

  it('only marks job refunded for safe statuses (not completed/delivered)', () => {
    expect(src).toContain('SAFE_TO_REFUND_JOB_STATUSES');
    // Extract the SAFE_TO_REFUND_JOB_STATUSES array from the source
    const listMatch = src.match(/SAFE_TO_REFUND_JOB_STATUSES\s*=\s*\[([^\]]+)\]/);
    expect(listMatch).not.toBeNull();
    const listContents = listMatch![1];
    // Pre-processing statuses must be present
    expect(listContents).toContain("'queued'");
    expect(listContents).toContain("'payment_pending'");
    // Terminal/delivery statuses must NOT be in the safe list
    expect(listContents).not.toContain("'completed'");
    expect(listContents).not.toContain("'delivered'");
  });

  it('never creates fiscal refund receipt without a matching sale receipt', () => {
    expect(src).toContain("operation_type', 'sale'");
    // Guard: only creates refund receipt if saleReceipt exists
    const saleCheckIdx = src.indexOf("operation_type', 'sale'");
    const refundInsertIdx = src.indexOf("operation_type: 'refund'");
    // Sale check must come before refund insert
    expect(saleCheckIdx).toBeGreaterThan(-1);
    expect(refundInsertIdx).toBeGreaterThan(-1);
    expect(saleCheckIdx).toBeLessThan(refundInsertIdx);
  });

  it('only reconciles Halyk ePay refunds (not other providers)', () => {
    expect(src).toContain(".eq('payment_provider', 'halyk_epay')");
  });

  it('detects REFUND, CANCEL, and CANCEL_OLD Halyk statusNames', () => {
    expect(src).toContain("'REFUND'");
    expect(src).toContain("'CANCEL'");
    expect(src).toContain("'CANCEL_OLD'");
  });

  it('requires resultCode=100 AND refund statusName (prevents false positives)', () => {
    expect(src).toContain('resultCode === 100');
    // Both conditions must appear in same expression
    const rcIdx = src.indexOf('resultCode === 100');
    const snIdx = src.indexOf("'REFUND'", rcIdx);
    expect(snIdx - rcIdx).toBeLessThan(200); // within same statement
  });

  it('notifies operator via Telegram on confirmed refund', () => {
    expect(src).toContain('notifyOperatorPaymentAlert');
  });

  it('uses cooldown to avoid spamming Halyk API', () => {
    expect(src).toContain('COOLDOWN_MINUTES');
    expect(src).toContain('status_checked_at');
  });

  it('does not expose Halyk credentials in logs', () => {
    expect(src).not.toContain('client_secret');
    expect(src).not.toContain('access_token');
  });

  it('limits batch to prevent timeout (BATCH_LIMIT)', () => {
    expect(src).toContain('BATCH_LIMIT');
    expect(src).toContain('.limit(BATCH_LIMIT)');
  });
});

describe('reconcile-refunds — migration 0040 (updated_at column)', () => {
  it('migration adds updated_at column idempotently', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0040_payment_transactions_updated_at.sql'),
      'utf-8',
    );
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS updated_at');
    expect(sql).toContain('payment_transactions');
  });

  it('migration does not drop any column', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0040_payment_transactions_updated_at.sql'),
      'utf-8',
    );
    expect(sql.toUpperCase()).not.toContain('DROP COLUMN');
  });
});

describe('reconcile-refunds — migration 0041 (jobs refunded status)', () => {
  it('migration extends jobs status constraint to include refunded', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0041_jobs_refunded_status.sql'),
      'utf-8',
    );
    expect(sql).toContain("'refunded'");
    expect(sql).toContain('jobs_status_check');
  });

  it('migration includes canceled in jobs status constraint', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0041_jobs_refunded_status.sql'),
      'utf-8',
    );
    expect(sql).toContain("'canceled'");
  });

  it('migration drops old constraint before adding new (safe ALTER flow)', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0041_jobs_refunded_status.sql'),
      'utf-8',
    );
    const dropIdx = sql.indexOf('DROP CONSTRAINT IF EXISTS');
    const addIdx = sql.indexOf('ADD CONSTRAINT');
    expect(dropIdx).toBeGreaterThan(-1);
    expect(addIdx).toBeGreaterThan(-1);
    expect(dropIdx).toBeLessThan(addIdx);
  });

  it('migration preserves all original job statuses', () => {
    const sql = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/0041_jobs_refunded_status.sql'),
      'utf-8',
    );
    const ORIGINAL_STATUSES = ['payment_pending', 'queued', 'ocr_in_progress', 'ocr_completed', 'translation_in_progress', 'pdf_rendering', 'completed', 'failed'];
    for (const status of ORIGINAL_STATUSES) {
      expect(sql).toContain(`'${status}'`);
    }
  });
});
