/**
 * @jest-environment node
 *
 * Structural tests for worker/src/index.ts startup and fiscal processor scheduling.
 *
 * These verify invariants about the code — not runtime behaviour — because index.ts
 * cannot be unit-tested without spinning up the full worker loop with a real DB.
 */

import * as fs from 'fs';
import * as path from 'path';

const INDEX_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'index.ts'),
  'utf-8',
);

describe('worker startup — fiscal processor scheduling', () => {
  it('imports processPendingFiscalReceipts directly (not via reconcileFiscalAndRefunds)', () => {
    expect(INDEX_SRC).toContain("import { processPendingFiscalReceipts } from './lib/fiscal-processor'");
  });

  it('calls processPendingFiscalReceipts on startup (before the setInterval registration)', () => {
    // The startup void call must appear before the setInterval(...FISCAL_PROCESSOR_INTERVAL_MS)
    const startupCallPos = INDEX_SRC.indexOf('void processPendingFiscalReceipts()');
    // Find the setInterval(..., FISCAL_PROCESSOR_INTERVAL_MS) — the second occurrence
    const setIntervalPos = INDEX_SRC.indexOf('}, FISCAL_PROCESSOR_INTERVAL_MS)');
    expect(startupCallPos).toBeGreaterThan(-1);
    expect(setIntervalPos).toBeGreaterThan(-1);
    expect(startupCallPos).toBeLessThan(setIntervalPos);
  });

  it('registers a setInterval for fiscal processor separate from job poll loop', () => {
    expect(INDEX_SRC).toContain('FISCAL_PROCESSOR_INTERVAL_MS');
    // Must have its own setInterval call for fiscal processor
    const fiscalIntervalPos = INDEX_SRC.indexOf('processPendingFiscalReceipts().catch');
    expect(fiscalIntervalPos).toBeGreaterThan(-1);
    // Must be inside a setInterval
    const setIntervalBlock = INDEX_SRC.slice(
      INDEX_SRC.lastIndexOf('setInterval', fiscalIntervalPos),
      fiscalIntervalPos + 50,
    );
    expect(setIntervalBlock).toContain('setInterval');
  });

  it('FISCAL_PROCESSOR_INTERVAL_MS is 30 seconds (not 5 minutes)', () => {
    const match = INDEX_SRC.match(/FISCAL_PROCESSOR_INTERVAL_MS\s*=\s*(\d+(?:_\d+)*)/);
    expect(match).not.toBeNull();
    const value = parseInt(match![1]!.replace(/_/g, ''), 10);
    expect(value).toBe(30_000);
  });

  it('reconcileFiscalAndRefunds still registered on its own 5-minute interval', () => {
    expect(INDEX_SRC).toContain('FISCAL_RECONCILE_INTERVAL_MS');
    expect(INDEX_SRC).toContain('reconcileFiscalAndRefunds().catch');
    const match = INDEX_SRC.match(/FISCAL_RECONCILE_INTERVAL_MS\s*=\s*(\d+(?:_\d+)*(?:\s*\*\s*\d+(?:_\d+)*)*)/);
    expect(match).not.toBeNull();
  });

  it('fiscal processor and reconcile are separate setInterval calls', () => {
    // Count setInterval occurrences that involve fiscal logic
    const processorOccurrences = (INDEX_SRC.match(/processPendingFiscalReceipts/g) ?? []).length;
    expect(processorOccurrences).toBeGreaterThanOrEqual(2); // startup + interval
  });

  it('startup call is non-blocking (void, with .catch)', () => {
    const startupLine = INDEX_SRC.slice(
      INDEX_SRC.indexOf('void processPendingFiscalReceipts()'),
      INDEX_SRC.indexOf('void processPendingFiscalReceipts()') + 200,
    );
    expect(startupLine).toContain('.catch');
  });
});

describe('worker startup — Vercel does not call Webkassa', () => {
  it('index.ts does not import webkassa-client or webkassa-provider', () => {
    expect(INDEX_SRC).not.toContain('webkassa-client');
    expect(INDEX_SRC).not.toContain('webkassa-provider');
  });

  it('fiscal-reconciliation does not call processPendingFiscalReceipts (moved to dedicated interval)', () => {
    const reconcileSrc = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'fiscal-reconciliation.ts'),
      'utf-8',
    );
    // processPendingFiscalReceipts must NOT be called inside reconcileFiscalAndRefunds
    const reconcileFnStart = reconcileSrc.indexOf('export async function reconcileFiscalAndRefunds');
    const reconcileFnEnd = reconcileSrc.indexOf('\nexport ', reconcileFnStart + 10);
    const reconcileFnSrc = reconcileSrc.slice(reconcileFnStart, reconcileFnEnd);
    expect(reconcileFnSrc).not.toContain('processPendingFiscalReceipts');
  });
});

describe('fiscal-processor — production isolation', () => {
  it('fiscal-processor.ts filters by provider_environment (no cross-env processing)', () => {
    const processorSrc = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'fiscal-processor.ts'),
      'utf-8',
    );
    expect(processorSrc).toContain("'provider_environment', env.FISCAL_PROVIDER_ENV");
  });

  it('fiscal-processor.ts filters by provider=webkassa', () => {
    const processorSrc = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'fiscal-processor.ts'),
      'utf-8',
    );
    expect(processorSrc).toContain("'provider', 'webkassa'");
  });

  it('fiscal-processor.ts filters provider_receipt_id IS NULL (prevents duplicate processing)', () => {
    const processorSrc = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'fiscal-processor.ts'),
      'utf-8',
    );
    expect(processorSrc).toContain(".is('provider_receipt_id', null)");
  });

  it('fiscal-processor.ts logs [fiscal-processor] tick on every call', () => {
    const processorSrc = fs.readFileSync(
      path.join(__dirname, '..', 'lib', 'fiscal-processor.ts'),
      'utf-8',
    );
    expect(processorSrc).toContain('[fiscal-processor] tick');
    expect(processorSrc).toContain("configured,");
  });
});
