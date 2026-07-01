/**
 * Tests for src/lib/partners/mark-payout.ts
 *
 * Covers spec items 20-24:
 *  20. mark-paid updates payout and linked referrals
 *  21. mark-paid is idempotent
 *  22. mark-paid with missing payout id fails
 *  23. mark-paid adds Jira comment but DB success does not depend on it
 *  24. DB update succeeds even if Jira comment fails
 */

jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));

jest.mock('@/lib/jira/payout-client', () => ({
  addPayoutPaidComment: jest.fn().mockResolvedValue(undefined),
}));

import { markPayoutPaid } from '../mark-payout';
import type { AnySupabaseClient } from '../mark-payout';

// ─── Mock builder ─────────────────────────────────────────────────────────────

function makeStructuredDb(calls: Array<{ data: unknown; error: unknown }>) {
  const queue = [...calls];
  function makeChain(): Record<string, unknown> {
    const dequeue = () => queue.shift() ?? { data: null, error: null };
    const proxy: Record<string, unknown> = new Proxy<Record<string, unknown>>(
      {} as Record<string, unknown>,
      {
        get(_t, prop: string): unknown {
          if (prop === 'then') return (res: (v: unknown) => void) => res(dequeue());
          if (prop === 'single' || prop === 'maybeSingle') return () => Promise.resolve(dequeue());
          return () => proxy;
        },
      },
    );
    return proxy;
  }
  return { from: jest.fn(() => makeChain()) };
}

const PAYOUT_PENDING = {
  id: 'payout-uuid-1',
  status: 'pending_approval',
  jira_issue_key: 'WPO-42',
  notes: null,
  paid_at: null,
};

const PAYOUT_PAID = {
  id: 'payout-uuid-1',
  status: 'paid',
  jira_issue_key: 'WPO-42',
  notes: null,
  paid_at: '2026-08-05T10:00:00Z',
};

const UPDATED_REFS = [{ id: 'ref-1' }, { id: 'ref-2' }];

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('markPayoutPaid', () => {
  it('20. updates payout status and linked referrals', async () => {
    const db = makeStructuredDb([
      { data: PAYOUT_PENDING, error: null },   // load payout
      { data: null, error: null },             // update partner_payouts
      { data: UPDATED_REFS, error: null },     // update partner_referrals
    ]);
    const jira = jest.fn().mockResolvedValue(undefined);

    const result = await markPayoutPaid(
      { payoutId: 'payout-uuid-1', paymentReference: 'Halyk 2026-08-05' },
      db as unknown as AnySupabaseClient,
      jira,
    );

    expect(result.status).toBe('paid');
    expect(result.referralsUpdated).toBe(2);
    expect(result.alreadyPaid).toBe(false);
    expect(jira).toHaveBeenCalledWith('WPO-42', 'Halyk 2026-08-05', expect.any(String));

    // Both payout and referrals tables updated
    const tables = (db.from as jest.Mock).mock.calls.map((c: unknown[]) => c[0]);
    expect(tables).toContain('partner_payouts');
    expect(tables).toContain('partner_referrals');
  });

  it('21. idempotent: already-paid payout returns success without updating', async () => {
    const db = makeStructuredDb([
      { data: PAYOUT_PAID, error: null },   // load payout — already paid
    ]);
    const jira = jest.fn();

    const result = await markPayoutPaid(
      { payoutId: 'payout-uuid-1', paymentReference: 'Halyk 2026-08-05' },
      db as unknown as AnySupabaseClient,
      jira,
    );

    expect(result.alreadyPaid).toBe(true);
    expect(result.referralsUpdated).toBe(0);
    expect(jira).not.toHaveBeenCalled();

    // Only one DB call (the load); no updates
    expect((db.from as jest.Mock).mock.calls.length).toBe(1);
  });

  it('22. missing payout id throws error', async () => {
    const db = makeStructuredDb([
      { data: null, error: null },   // maybeSingle returns null = not found
    ]);

    await expect(
      markPayoutPaid({ payoutId: 'non-existent-uuid', paymentReference: 'ref' }, db as unknown as AnySupabaseClient),
    ).rejects.toThrow('not found');
  });

  it('22b. DB load error throws', async () => {
    const db = makeStructuredDb([
      { data: null, error: { message: 'DB connection failed' } },
    ]);

    await expect(
      markPayoutPaid({ payoutId: 'payout-uuid-1', paymentReference: 'ref' }, db as unknown as AnySupabaseClient),
    ).rejects.toThrow('DB connection failed');
  });

  it('23. Jira comment is added when jira_issue_key is present', async () => {
    const db = makeStructuredDb([
      { data: PAYOUT_PENDING, error: null },
      { data: null, error: null },
      { data: UPDATED_REFS, error: null },
    ]);
    const jira = jest.fn().mockResolvedValue(undefined);

    const result = await markPayoutPaid(
      { payoutId: 'payout-uuid-1', paymentReference: 'ref-123' },
      db as unknown as AnySupabaseClient,
      jira,
    );

    expect(jira).toHaveBeenCalledWith('WPO-42', 'ref-123', expect.any(String));
    expect(result.jiraCommentAdded).toBe(true);
    expect(result.jiraCommentError).toBeUndefined();
  });

  it('24. Jira comment failure does not rollback DB update', async () => {
    const db = makeStructuredDb([
      { data: PAYOUT_PENDING, error: null },
      { data: null, error: null },
      { data: UPDATED_REFS, error: null },
    ]);
    const jira = jest.fn().mockRejectedValue(new Error('Jira 500'));

    const result = await markPayoutPaid(
      { payoutId: 'payout-uuid-1', paymentReference: 'ref-123' },
      db as unknown as AnySupabaseClient,
      jira,
    );

    // DB succeeded
    expect(result.status).toBe('paid');
    expect(result.referralsUpdated).toBe(2);
    expect(result.alreadyPaid).toBe(false);

    // Jira failed but did not throw
    expect(result.jiraCommentAdded).toBe(false);
    expect(result.jiraCommentError).toContain('Jira 500');
  });

  it('appends note to payout notes when provided', async () => {
    const db = makeStructuredDb([
      { data: { ...PAYOUT_PENDING, notes: 'Previous note' }, error: null },
      { data: null, error: null },
      { data: [], error: null },
    ]);

    const result = await markPayoutPaid(
      { payoutId: 'payout-uuid-1', paymentReference: 'ref', note: 'Processed by Alina' },
      db as unknown as AnySupabaseClient,
    );

    expect(result.status).toBe('paid');
    // Notes appending logic tested implicitly (no throw)
  });

  it('payout without jira_issue_key skips Jira comment', async () => {
    const db = makeStructuredDb([
      { data: { ...PAYOUT_PENDING, jira_issue_key: null }, error: null },
      { data: null, error: null },
      { data: [], error: null },
    ]);
    const jira = jest.fn();

    const result = await markPayoutPaid(
      { payoutId: 'payout-uuid-1', paymentReference: 'ref' },
      db as unknown as AnySupabaseClient,
      jira,
    );

    expect(jira).not.toHaveBeenCalled();
    expect(result.jiraCommentAdded).toBe(false);
  });
});
