import { mapFreedomPayResult } from '../status-map';

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
