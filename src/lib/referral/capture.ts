export interface ReferralParams {
  refCode: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  capturedAt?: string;
  expiresAt?: string;
}

const STORAGE_KEY = 'wpo_referral';
const TTL_DAYS = 30;

/** Extract referral params from a URL search string. Returns null if no ref or UTM params found. */
export function extractReferralParams(search: string): ReferralParams | null {
  const params = new URLSearchParams(search);
  const refCode    = params.get('ref');
  const utmSource  = params.get('utm_source');
  const utmMedium  = params.get('utm_medium');
  const utmCampaign = params.get('utm_campaign');
  const utmContent = params.get('utm_content');
  const utmTerm    = params.get('utm_term');

  if (!refCode && !utmSource && !utmMedium && !utmCampaign) return null;

  const now = new Date();
  const expires = new Date(now.getTime() + TTL_DAYS * 24 * 60 * 60 * 1000);

  return {
    refCode,
    utmSource,
    utmMedium,
    utmCampaign,
    utmContent,
    utmTerm,
    capturedAt: now.toISOString(),
    expiresAt: expires.toISOString(),
  };
}

/** Persist referral params to sessionStorage and localStorage (30-day TTL). */
export function saveReferralParams(params: ReferralParams): void {
  const serialized = JSON.stringify(params);
  try {
    sessionStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // sessionStorage unavailable — silently ignore
  }
  try {
    localStorage.setItem(STORAGE_KEY, serialized);
  } catch {
    // localStorage unavailable — silently ignore
  }
}

/**
 * Read previously saved referral params.
 * Prefers localStorage (survives tab close); falls back to sessionStorage.
 * Returns null if not found or if the stored params have expired.
 */
export function loadReferralParams(): ReferralParams | null {
  // Try localStorage first (persists across tabs and sessions)
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ReferralParams;
      if (!isExpired(parsed)) return parsed;
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore
  }

  // Fallback to sessionStorage
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReferralParams;
    if (!isExpired(parsed)) return parsed;
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  } catch {
    return null;
  }
}

/** Clear stored referral params from both storages (e.g. after attaching to an order). */
export function clearReferralParams(): void {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

function isExpired(params: ReferralParams): boolean {
  if (!params.expiresAt) return false; // legacy entries without TTL are treated as valid
  return Date.now() > new Date(params.expiresAt).getTime();
}
