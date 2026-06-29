export interface ReferralParams {
  refCode: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
}

const STORAGE_KEY = 'wpo_referral';

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

  return { refCode, utmSource, utmMedium, utmCampaign, utmContent, utmTerm };
}

/** Persist referral params to sessionStorage. Existing params are NOT overwritten by empty values. */
export function saveReferralParams(params: ReferralParams): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(params));
  } catch {
    // sessionStorage unavailable (private browsing restrictions) — silently ignore
  }
}

/** Read previously saved referral params from sessionStorage. Returns null if none. */
export function loadReferralParams(): ReferralParams | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ReferralParams;
  } catch {
    return null;
  }
}

/** Clear stored referral params (e.g. after attaching to an order). */
export function clearReferralParams(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // silently ignore
  }
}
