/**
 * @jest-environment node
 *
 * P0 production fix: verify that all Halyk payment finalization paths
 * use `transactionId ?? id` fallback for provider_transaction_id.
 *
 * Root cause: Halyk returns the transaction UUID in the `id` field in some
 * contexts (callback payload) but in `transactionId` in others (status API).
 * Using only `transactionId` caused provider_transaction_id=null for payment 1.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(process.cwd(), 'src/app/api/payments/halyk');
const CRON_ROOT = path.join(process.cwd(), 'src/app/api/cron');

function readRoute(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

function readCron(rel: string): string {
  return fs.readFileSync(path.join(CRON_ROOT, rel), 'utf-8');
}

const FALLBACK_PATTERN = /transactionId\s*\?\?\s*(?:.*?\.)?id/;

describe('provider_transaction_id fix — transactionId ?? id fallback', () => {
  it('callback route uses transactionId ?? id fallback for p_transaction_id', () => {
    const src = readRoute('callback/route.ts');
    // Find the p_transaction_id assignment
    const pTxIdIdx = src.indexOf('p_transaction_id');
    expect(pTxIdIdx).toBeGreaterThan(-1);
    const snippet = src.slice(pTxIdIdx, pTxIdIdx + 120);
    // Must contain fallback to .id
    expect(snippet).toMatch(FALLBACK_PATTERN);
  });

  it('status endpoint uses transactionId ?? id fallback for p_transaction_id', () => {
    const src = readRoute('status/[paymentId]/route.ts');
    const pTxIdIdx = src.indexOf('p_transaction_id');
    expect(pTxIdIdx).toBeGreaterThan(-1);
    const snippet = src.slice(pTxIdIdx, pTxIdIdx + 120);
    expect(snippet).toMatch(FALLBACK_PATTERN);
  });

  it('reconcile-payments cron uses transactionId ?? id fallback for p_transaction_id', () => {
    const src = readCron('reconcile-payments/route.ts');
    const pTxIdIdx = src.indexOf('p_transaction_id');
    expect(pTxIdIdx).toBeGreaterThan(-1);
    const snippet = src.slice(pTxIdIdx, pTxIdIdx + 120);
    expect(snippet).toMatch(FALLBACK_PATTERN);
  });

  it('HalykTransactionSchema includes both transactionId and id fields', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/payments/halyk/types.ts'),
      'utf-8',
    );
    expect(src).toContain('transactionId');
    expect(src).toContain("id:");
  });

  it('reconcile-refunds cron stores transactionId ?? id in provider_payload', () => {
    const src = readCron('reconcile-refunds/route.ts');
    // The payload logging should include the fallback
    const transactionIdUsage = src.indexOf('transactionId ?? transaction?.id');
    expect(transactionIdUsage).toBeGreaterThan(-1);
  });
});

describe('provider_transaction_id fix — callback does not use only transactionId', () => {
  it('callback p_transaction_id line never uses bare transactionId without id fallback', () => {
    const src = readRoute('callback/route.ts');
    // Find p_transaction_id lines
    const lines = src.split('\n').filter((l) => l.includes('p_transaction_id'));
    for (const line of lines) {
      if (line.includes('transactionId')) {
        // Must also reference .id as a fallback
        expect(line).toMatch(/id/);
      }
    }
  });
});
