import { mapHalykStatus, isTerminalStatus, isPaidStatus, mapToPublicStatus } from '../status-map';

describe('mapHalykStatus (internal)', () => {
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

  it('maps resultCode=100 + AUTH to payment_pending (1-step auto-capture in progress)', () => {
    // WPO uses 1-step CHARGE flow. AUTH = pre-authorized, Halyk will auto-CHARGE.
    // Must NOT return requires_review — that would confuse frontend polling.
    expect(mapHalykStatus(100, 'AUTH')).toBe('payment_pending');
  });

  it('maps resultCode=100 + unknown statusName to requires_review (internal)', () => {
    expect(mapHalykStatus(100, 'MYSTERY')).toBe('requires_review');
  });

  it('maps resultCode=107 to payment_pending', () => {
    expect(mapHalykStatus(107, undefined)).toBe('payment_pending');
  });

  it('maps resultCode=102 to payment_pending', () => {
    expect(mapHalykStatus(102, undefined)).toBe('payment_pending');
  });

  it('maps resultCode=103 to requires_review (internal, operator review)', () => {
    expect(mapHalykStatus(103, undefined)).toBe('requires_review');
  });

  it('maps unknown resultCode to requires_review (internal)', () => {
    expect(mapHalykStatus(999, 'CHARGE')).toBe('requires_review');
  });

  it('code=ok without CHARGE does NOT produce paid', () => {
    expect(mapHalykStatus(100, 'NEW')).not.toBe('paid');
    expect(mapHalykStatus(102, undefined)).not.toBe('paid');
  });
});

describe('mapToPublicStatus — never exposes internal-only statuses', () => {
  it('maps paid to paid (terminal, success)', () => {
    const r = mapToPublicStatus('paid');
    expect(r.status).toBe('paid');
    expect(r.isPublicTerminal).toBe(true);
    expect(r.isAuthorized).toBe(false);
  });

  it('maps failed to failed (terminal, failure)', () => {
    const r = mapToPublicStatus('failed');
    expect(r.status).toBe('failed');
    expect(r.isPublicTerminal).toBe(true);
  });

  it('maps canceled to canceled (terminal)', () => {
    const r = mapToPublicStatus('canceled');
    expect(r.status).toBe('canceled');
    expect(r.isPublicTerminal).toBe(true);
  });

  it('maps refunded to refunded (terminal)', () => {
    const r = mapToPublicStatus('refunded');
    expect(r.status).toBe('refunded');
    expect(r.isPublicTerminal).toBe(true);
  });

  it('maps payment_pending to payment_pending (non-terminal)', () => {
    const r = mapToPublicStatus('payment_pending');
    expect(r.status).toBe('payment_pending');
    expect(r.isPublicTerminal).toBe(false);
    expect(r.isAuthorized).toBe(false);
  });

  it('maps payment_pending + AUTH providerStatus to authorized', () => {
    const r = mapToPublicStatus('payment_pending', 'AUTH');
    expect(r.status).toBe('authorized');
    expect(r.isAuthorized).toBe(true);
    expect(r.isPublicTerminal).toBe(false);
    expect(r.messageCode).toBe('PAYMENT_AUTHORIZED_WAITING_FOR_CHARGE');
  });

  it('maps requires_review to payment_pending (NEVER exposes internal status)', () => {
    const r = mapToPublicStatus('requires_review');
    expect(r.status).toBe('payment_pending');
    expect(r.status).not.toBe('requires_review');
    expect(r.messageCode).toBe('MANUAL_REVIEW_PENDING');
    expect(r.isPublicTerminal).toBe(false);
  });

  it('maps duplicate_charge_review to unknown (terminal, operator resolves)', () => {
    const r = mapToPublicStatus('duplicate_charge_review');
    expect(r.status).toBe('unknown');
    expect(r.status).not.toBe('duplicate_charge_review');
    expect(r.messageCode).toBe('DUPLICATE_CHARGE_REVIEW');
    expect(r.isPublicTerminal).toBe(true);
  });

  it('maps refund_pending to payment_pending with REFUND_IN_PROGRESS code', () => {
    const r = mapToPublicStatus('refund_pending');
    expect(r.status).toBe('payment_pending');
    expect(r.messageCode).toBe('REFUND_IN_PROGRESS');
    expect(r.isPublicTerminal).toBe(false);
  });

  it('status endpoint will never return requires_review to frontend after mapping', () => {
    // Simulate all internal statuses that could arrive from DB
    const internalStatuses = ['payment_pending', 'paid', 'failed', 'canceled', 'refunded',
      'refund_pending', 'requires_review', 'duplicate_charge_review'] as const;
    for (const s of internalStatuses) {
      const r = mapToPublicStatus(s);
      expect(r.status).not.toBe('requires_review');
      expect(r.status).not.toBe('duplicate_charge_review');
    }
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

describe('AUTH invariants — fiscal and worker must not fire for AUTH', () => {
  it('AUTH internal status is NOT paid — fiscal receipt must not be created', () => {
    const authInternal = mapHalykStatus(100, 'AUTH');
    expect(isPaidStatus(authInternal)).toBe(false);
  });

  it('AUTH public status is authorized, non-terminal — worker must not pick up', () => {
    const authInternal = mapHalykStatus(100, 'AUTH');
    const authPublic = mapToPublicStatus(authInternal, 'AUTH');
    expect(authPublic.status).toBe('authorized');
    expect(authPublic.isPublicTerminal).toBe(false);
    expect(authPublic.isAuthorized).toBe(true);
  });

  it('CHARGE still maps to paid even for quote-based amounts — no regression', () => {
    expect(mapHalykStatus(100, 'CHARGE')).toBe('paid');
    const pub = mapToPublicStatus('paid');
    expect(pub.status).toBe('paid');
    expect(pub.isPublicTerminal).toBe(true);
  });

  it('amount_source (quote vs legacy_test) does not affect status mapping — mapping is pure', () => {
    // The mapping functions are pure; amount_source is a DB label, not an input.
    // Legacy 3999 and quote-based 7200 both go through the same mapHalykStatus logic.
    expect(mapHalykStatus(100, 'CHARGE')).toBe('paid');
    expect(mapHalykStatus(100, 'AUTH')).toBe('payment_pending');
    // Confirms no hardcoded amount-based branching exists.
  });
});
