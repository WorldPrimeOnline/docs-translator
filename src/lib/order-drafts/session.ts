import { cookies } from 'next/headers';

const COOKIE_NAME = 'wpo_draft_session';
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * Opaque correlation token for anonymous wizard visitors — used only for rate-limiting
 * and draft ownership checks before login. Not a Supabase auth concept and not a
 * security credential (draft rows contain no payment data, only pre-checkout inputs).
 */
export async function getOrCreateDraftSessionToken(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE_NAME)?.value;
  if (existing) return existing;

  const token = crypto.randomUUID();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
  return token;
}

export async function getDraftSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE_NAME)?.value ?? null;
}
