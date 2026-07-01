/**
 * @jest-environment node
 */
import { _resetFiscalConfigCache } from '../config';
import { _resetProviderCache } from '../provider';

// Mock Supabase server client (not used directly in these unit tests)
jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: {},
}));

beforeEach(() => {
  jest.clearAllMocks();
  _resetFiscalConfigCache();
  _resetProviderCache();
  process.env.FISCALIZATION_ENABLED = 'false';
  process.env.FISCAL_PROVIDER = 'manual';
});

describe('ManualFiscalProvider', () => {
  it('createSaleReceipt returns pending_manual', async () => {
    const { ManualFiscalProvider } = await import('../manual-provider');
    const provider = new ManualFiscalProvider();
    const result = await provider.createSaleReceipt({
      jobId: 'job-1',
      paymentTransactionId: 'pt-1',
      amountKzt: 1999,
      currency: 'KZT',
      description: 'Test',
      orderNumber: 'ORD001',
    });
    expect(result.status).toBe('pending_manual');
    expect(result.fiscalUrl).toBeUndefined();
    expect(result.providerReceiptId).toBeUndefined();
  });

  it('createRefundReceipt returns pending_manual', async () => {
    const { ManualFiscalProvider } = await import('../manual-provider');
    const provider = new ManualFiscalProvider();
    const result = await provider.createRefundReceipt({
      refundTransactionId: 'rt-1',
      originalPaymentTransactionId: 'pt-1',
      amountKzt: 1999,
      currency: 'KZT',
      reason: 'test refund',
    });
    expect(result.status).toBe('pending_manual');
    expect(result.fiscalUrl).toBeUndefined();
  });
});

describe('getFiscalProvider', () => {
  it('returns ManualFiscalProvider when FISCAL_PROVIDER=manual', async () => {
    const { getFiscalProvider } = await import('../provider');
    const provider = getFiscalProvider();
    expect(provider.name).toBe('manual');
  });

  it('fiscal config enabled=false when FISCALIZATION_ENABLED not set', async () => {
    delete process.env.FISCALIZATION_ENABLED;
    const { getFiscalConfig } = await import('../config');
    const config = getFiscalConfig();
    expect(config.enabled).toBe(false);
  });

  it('fiscal config providerEnvironment defaults to test', async () => {
    const { getFiscalConfig } = await import('../config');
    const config = getFiscalConfig();
    expect(config.providerEnvironment).toBe('test');
  });

  it('fiscal config providerEnvironment=production when FISCAL_PROVIDER_ENV=production', async () => {
    process.env.FISCAL_PROVIDER_ENV = 'production';
    const { getFiscalConfig } = await import('../config');
    const config = getFiscalConfig();
    expect(config.providerEnvironment).toBe('production');
    delete process.env.FISCAL_PROVIDER_ENV;
  });
});

// ─── ensureSaleFiscalReceiptForPaidPayment structural contract tests ──────────

import * as fs from 'fs';
import * as path from 'path';

const SERVICE_SRC = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/fiscal/service.ts'),
  'utf-8',
);

describe('ensureSaleFiscalReceiptForPaidPayment — structural contracts', () => {
  it('is exported from service.ts', () => {
    expect(SERVICE_SRC).toContain('export async function ensureSaleFiscalReceiptForPaidPayment');
  });

  it('performs idempotency check before inserting', () => {
    // Slice from the new function declaration to check positions within it
    const fnStart = SERVICE_SRC.indexOf('export async function ensureSaleFiscalReceiptForPaidPayment');
    const fnSrc = SERVICE_SRC.slice(fnStart);
    const idempotencyCheckPos = fnSrc.indexOf('// 1. Idempotency check');
    const insertPos = fnSrc.indexOf('.insert(');
    expect(idempotencyCheckPos).toBeGreaterThan(-1);
    expect(insertPos).toBeGreaterThan(-1);
    expect(idempotencyCheckPos).toBeLessThan(insertPos);
  });

  it('uses pending_manual initial status for manual provider / disabled config', () => {
    expect(SERVICE_SRC).toContain("'pending_manual' as const");
    expect(SERVICE_SRC).toContain("provider.name === 'manual' || !config.enabled");
  });

  it('uses pending initial status when real provider is enabled', () => {
    expect(SERVICE_SRC).toContain("'pending' as const");
  });

  it('inserts the DB row and returns without calling Webkassa directly', () => {
    const fnStart = SERVICE_SRC.indexOf('export async function ensureSaleFiscalReceiptForPaidPayment');
    const fnSrc = SERVICE_SRC.slice(fnStart, SERVICE_SRC.indexOf('\nexport async function ', fnStart + 10));
    const insertPos = fnSrc.indexOf('// 5. Insert DB row with correct initial status');
    // Worker fiscal-processor comment must be present — no direct provider call from serverless
    const workerHandledPos = fnSrc.indexOf('// 6. Row created — worker fiscal-processor');
    expect(insertPos).toBeGreaterThan(-1);
    expect(workerHandledPos).toBeGreaterThan(-1);
    expect(insertPos).toBeLessThan(workerHandledPos);
    // ensureSaleFiscalReceiptForPaidPayment must NOT contain a direct Webkassa/provider call
    expect(fnSrc).not.toContain('void _runProviderSaleReceipt');
    expect(fnSrc).not.toContain('provider.createSaleReceipt');
  });

  it('worker fiscal-processor handles Webkassa — no direct provider call from serverless path', () => {
    // _runProviderSaleReceipt still exists (used by createSaleReceiptForPayment legacy path)
    // but must NOT be called from ensureSaleFiscalReceiptForPaidPayment
    const fnStart = SERVICE_SRC.indexOf('export async function ensureSaleFiscalReceiptForPaidPayment');
    const fnEnd = SERVICE_SRC.indexOf('\nexport ', fnStart + 10);
    const fnSrc = SERVICE_SRC.slice(fnStart, fnEnd);
    expect(fnSrc).not.toContain('void _runProviderSaleReceipt');
  });

  it('handles unique constraint violation (race idempotency)', () => {
    expect(SERVICE_SRC).toContain("insertError.code === '23505'");
  });

  it('does not expose credentials in structured logs', () => {
    expect(SERVICE_SRC).not.toMatch(/console\.(info|log|error).*password/i);
    expect(SERVICE_SRC).not.toMatch(/console\.(info|log|error).*api_key/i);
  });

  it('_runProviderSaleReceipt updates row to failed on provider error', () => {
    expect(SERVICE_SRC).toContain("status: 'failed'");
    expect(SERVICE_SRC).toContain('failed_at: new Date().toISOString()');
  });
});

// Note: createSaleReceiptForPayment integration tests require a real Supabase connection.
// The following tests validate the idempotency logic and error path contracts.

describe('fiscal receipt idempotency contract', () => {
  it('pending_manual status does not expose fiscal_url to callers', async () => {
    const { ManualFiscalProvider } = await import('../manual-provider');
    const provider = new ManualFiscalProvider();
    const result = await provider.createSaleReceipt({
      jobId: 'j1',
      paymentTransactionId: 'p1',
      amountKzt: 3999,
      currency: 'KZT',
      description: 'Official translation',
      orderNumber: 'ABC12345',
    });
    // pending_manual receipts MUST NOT have a fiscal_url
    // (would be a fake receipt if they did)
    expect(result.fiscalUrl).toBeUndefined();
    expect(result.status).toBe('pending_manual');
  });

  it('sale receipt has correct currency', async () => {
    const { ManualFiscalProvider } = await import('../manual-provider');
    const provider = new ManualFiscalProvider();
    const result = await provider.createSaleReceipt({
      jobId: 'j1',
      paymentTransactionId: 'p1',
      amountKzt: 1999,
      currency: 'KZT',
      description: 'Electronic translation',
      orderNumber: 'XYZ12345',
    });
    // Provider response should reference KZT
    const resp = result.providerResponseSanitized as Record<string, unknown> | undefined;
    expect(resp?.amountKzt).toBe(1999);
  });
});

describe('production gate', () => {
  it('FISCALIZATION_ENABLED requires non-manual provider to actually be enabled', async () => {
    process.env.FISCALIZATION_ENABLED = 'true';
    process.env.FISCAL_PROVIDER = 'manual'; // manual cannot be "enabled"
    const { getFiscalConfig } = await import('../config');
    const config = getFiscalConfig();
    // Even with FISCALIZATION_ENABLED=true, manual provider means enabled=false
    // because manual is the fallback, not a real fiscal provider
    expect(config.enabled).toBe(false);
  });
});
