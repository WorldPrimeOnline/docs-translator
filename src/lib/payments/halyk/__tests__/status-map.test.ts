import { mapHalykStatus, isTerminalStatus, isPaidStatus } from '../status-map';

describe('mapHalykStatus', () => {
  it('maps resultCode=100 + CHARGE to paid', () => {
    expect(mapHalykStatus(100, 'CHARGE')).toBe('paid');
  });

  it('maps resultCode=100 + REFUND to refunded', () => {
    expect(mapHalykStatus(100, 'REFUND')).toBe('refunded');
  });

  it('maps resultCode=100 + CANCEL to canceled', () => {
    expect(mapHalykStatus(100, 'CANCEL')).toBe('canceled');
  });

  it('maps resultCode=100 + CANCEL_OLD to canceled', () => {
    expect(mapHalykStatus(100, 'CANCEL_OLD')).toBe('canceled');
  });

  it('maps resultCode=100 + FAILED to failed', () => {
    expect(mapHalykStatus(100, 'FAILED')).toBe('failed');
  });

  it('maps resultCode=100 + REJECT to failed', () => {
    expect(mapHalykStatus(100, 'REJECT')).toBe('failed');
  });

  it('maps resultCode=100 + 3D to failed', () => {
    expect(mapHalykStatus(100, '3D')).toBe('failed');
  });

  it('maps resultCode=100 + NEW to payment_pending', () => {
    expect(mapHalykStatus(100, 'NEW')).toBe('payment_pending');
  });

  it('maps resultCode=100 + FINGERPRINT to payment_pending', () => {
    expect(mapHalykStatus(100, 'FINGERPRINT')).toBe('payment_pending');
  });

  it('maps resultCode=100 + AUTH to requires_review (1-step unexpected)', () => {
    expect(mapHalykStatus(100, 'AUTH')).toBe('requires_review');
  });

  it('maps resultCode=100 + unknown statusName to requires_review', () => {
    expect(mapHalykStatus(100, 'MYSTERY')).toBe('requires_review');
  });

  it('maps resultCode=107 to payment_pending', () => {
    expect(mapHalykStatus(107, undefined)).toBe('payment_pending');
  });

  it('maps resultCode=102 to payment_pending', () => {
    expect(mapHalykStatus(102, undefined)).toBe('payment_pending');
  });

  it('maps resultCode=103 to requires_review', () => {
    expect(mapHalykStatus(103, undefined)).toBe('requires_review');
  });

  it('maps unknown resultCode to requires_review', () => {
    expect(mapHalykStatus(999, 'CHARGE')).toBe('requires_review');
  });

  it('code=ok without CHARGE does NOT produce paid', () => {
    // Simulates receiving code=ok in callback but resultCode/statusName do not indicate CHARGE
    expect(mapHalykStatus(100, 'NEW')).not.toBe('paid');
    expect(mapHalykStatus(102, undefined)).not.toBe('paid');
  });
});

describe('isTerminalStatus', () => {
  it('marks paid as terminal', () => expect(isTerminalStatus('paid')).toBe(true));
  it('marks failed as terminal', () => expect(isTerminalStatus('failed')).toBe(true));
  it('marks canceled as terminal', () => expect(isTerminalStatus('canceled')).toBe(true));
  it('marks duplicate_charge_review as terminal', () => expect(isTerminalStatus('duplicate_charge_review')).toBe(true));
  it('does not mark payment_pending as terminal', () => expect(isTerminalStatus('payment_pending')).toBe(false));
  it('does not mark requires_review as terminal', () => expect(isTerminalStatus('requires_review')).toBe(false));
});

describe('isPaidStatus', () => {
  it('returns true only for paid', () => {
    expect(isPaidStatus('paid')).toBe(true);
    expect(isPaidStatus('payment_pending')).toBe(false);
    expect(isPaidStatus('failed')).toBe(false);
    expect(isPaidStatus('requires_review')).toBe(false);
  });
});
