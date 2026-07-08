jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));

import { supabaseServer } from '@/lib/supabase/server';
import { checkAnonymousPreflightRateLimit, recordAnonymousPreflightAttempt } from '../rate-limit';

const mockFrom = supabaseServer.from as jest.Mock;

function countChain(count: number) {
  return {
    select: jest.fn().mockReturnValue({
      or: jest.fn().mockReturnValue({
        gte: jest.fn().mockResolvedValue({ count, error: null }),
      }),
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('checkAnonymousPreflightRateLimit', () => {
  it('allows the request when under both hourly and daily limits', async () => {
    mockFrom.mockReturnValueOnce(countChain(2)).mockReturnValueOnce(countChain(5));
    const result = await checkAnonymousPreflightRateLimit('session-1', '1.2.3.4');
    expect(result).toEqual({ allowed: true });
  });

  it('rejects with hourly_limit once the hourly count reaches the cap', async () => {
    mockFrom.mockReturnValueOnce(countChain(5)); // hourly check short-circuits before daily
    const result = await checkAnonymousPreflightRateLimit('session-1', '1.2.3.4');
    expect(result).toEqual({ allowed: false, reason: 'hourly_limit' });
  });

  it('rejects with daily_limit once the daily count reaches the cap even if hourly is fine', async () => {
    mockFrom.mockReturnValueOnce(countChain(1)).mockReturnValueOnce(countChain(20));
    const result = await checkAnonymousPreflightRateLimit('session-1', '1.2.3.4');
    expect(result).toEqual({ allowed: false, reason: 'daily_limit' });
  });

  it('falls back to session-token-only matching when no IP is available', async () => {
    const orMock = jest.fn().mockReturnValue({ gte: jest.fn().mockResolvedValue({ count: 0, error: null }) });
    mockFrom.mockReturnValue({ select: jest.fn().mockReturnValue({ or: orMock }) });

    await checkAnonymousPreflightRateLimit('session-1', null);

    expect(orMock).toHaveBeenCalledWith('session_token.eq.session-1');
  });
});

describe('recordAnonymousPreflightAttempt', () => {
  it('inserts an event row keyed by session token and IP', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValueOnce({ insert: insertMock });

    await recordAnonymousPreflightAttempt('session-1', '1.2.3.4');

    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        session_token: 'session-1',
        ip_address: '1.2.3.4',
        event_type: 'price_calculation',
      }),
    );
  });
});
