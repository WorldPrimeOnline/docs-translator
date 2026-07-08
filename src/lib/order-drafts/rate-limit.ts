import { supabaseServer } from '@/lib/supabase/server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabaseServer as any;

const HOURLY_LIMIT = 5;
const DAILY_LIMIT = 20;

export interface RateLimitCheck {
  allowed: boolean;
  reason?: 'hourly_limit' | 'daily_limit';
}

/**
 * Durable rate limit for anonymous price-calculation attempts — keyed by the
 * draft session cookie, with IP as a secondary signal. Unlike the in-memory
 * per-IP limiter in src/middleware.ts, this survives serverless cold starts
 * and supports separate hour/day windows.
 */
/** Matches events by session cookie OR client IP — a cleared cookie alone must not reset the limit. */
function ownerFilter(sessionToken: string, ipAddress: string | null): string {
  return ipAddress
    ? `session_token.eq.${sessionToken},ip_address.eq.${ipAddress}`
    : `session_token.eq.${sessionToken}`;
}

export async function checkAnonymousPreflightRateLimit(
  sessionToken: string,
  ipAddress: string | null,
): Promise<RateLimitCheck> {
  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const filter = ownerFilter(sessionToken, ipAddress);

  const { count: hourlyCount } = await db
    .from('anonymous_rate_limit_events')
    .select('id', { count: 'exact', head: true })
    .or(filter)
    .gte('created_at', oneHourAgo);

  if ((hourlyCount ?? 0) >= HOURLY_LIMIT) {
    return { allowed: false, reason: 'hourly_limit' };
  }

  const { count: dailyCount } = await db
    .from('anonymous_rate_limit_events')
    .select('id', { count: 'exact', head: true })
    .or(filter)
    .gte('created_at', oneDayAgo);

  if ((dailyCount ?? 0) >= DAILY_LIMIT) {
    return { allowed: false, reason: 'daily_limit' };
  }

  return { allowed: true };
}

export async function recordAnonymousPreflightAttempt(
  sessionToken: string,
  ipAddress: string | null,
): Promise<void> {
  await db.from('anonymous_rate_limit_events').insert({
    session_token: sessionToken,
    ip_address: ipAddress ?? 'unknown',
    event_type: 'price_calculation',
  });
}
