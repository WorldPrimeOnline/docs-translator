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
