import { mapFreedomPayResult, mapFreedomPayPaymentStatus } from '../status-map';

describe('mapFreedomPayResult', () => {
  it('maps "1" to paid', () => {
    expect(mapFreedomPayResult('1')).toBe('paid');
  });

  it('maps numeric 1 to paid', () => {
    expect(mapFreedomPayResult(1)).toBe('paid');
  });

  it('maps "0" to failed', () => {
    expect(mapFreedomPayResult('0')).toBe('failed');
  });

  it('maps "2" to payment_pending', () => {
    expect(mapFreedomPayResult('2')).toBe('payment_pending');
  });

  it('maps undefined to unknown', () => {
    expect(mapFreedomPayResult(undefined)).toBe('unknown');
  });

  it('maps null to unknown', () => {
    expect(mapFreedomPayResult(null)).toBe('unknown');
  });

  it('maps an unrecognized value to unknown', () => {
    expect(mapFreedomPayResult('99')).toBe('unknown');
  });

  it('trims whitespace before mapping', () => {
    expect(mapFreedomPayResult(' 1 ')).toBe('paid');
  });
});

// mapFreedomPayPaymentStatus drives get_status3.php (Status API) reconciliation —
// a DIFFERENT response schema from the Result URL callback above. 2026-08-20 incident:
// this used to be mapFreedomPayResult(statusResp.pgResult), but get_status3.php never
// returns pg_result at all, so a real provider "error" was silently read as an
// unrecognized field and the payment stayed stuck 'payment_pending' forever. Confirmed
// against real Freedom Pay cabinet data for merchant #588913: two failed test payments
// both showed provider status "error".
describe('mapFreedomPayPaymentStatus', () => {
  it('maps "success" to paid', () => {
    expect(mapFreedomPayPaymentStatus('success')).toBe('paid');
  });

  it('maps "error" to failed', () => {
    expect(mapFreedomPayPaymentStatus('error')).toBe('failed');
  });

  it('maps "process" to payment_pending', () => {
    expect(mapFreedomPayPaymentStatus('process')).toBe('payment_pending');
  });

  it('maps "pending" to payment_pending', () => {
    expect(mapFreedomPayPaymentStatus('pending')).toBe('payment_pending');
  });

  it('maps undefined to unknown, never paid', () => {
    expect(mapFreedomPayPaymentStatus(undefined)).toBe('unknown');
  });

  it('maps null to unknown, never paid', () => {
    expect(mapFreedomPayPaymentStatus(null)).toBe('unknown');
  });

  it('maps an unrecognized value to unknown, never paid', () => {
    expect(mapFreedomPayPaymentStatus('some_other_status')).toBe('unknown');
  });

  it('is case-insensitive', () => {
    expect(mapFreedomPayPaymentStatus('SUCCESS')).toBe('paid');
    expect(mapFreedomPayPaymentStatus('Error')).toBe('failed');
  });

  it('trims whitespace before mapping', () => {
    expect(mapFreedomPayPaymentStatus(' success ')).toBe('paid');
  });

  it('never maps a numeric pg_result-style value (0/1/2) to anything but unknown — proves the two schemas are not conflated', () => {
    expect(mapFreedomPayPaymentStatus('1')).toBe('unknown');
    expect(mapFreedomPayPaymentStatus('0')).toBe('unknown');
    expect(mapFreedomPayPaymentStatus('2')).toBe('unknown');
  });
});
