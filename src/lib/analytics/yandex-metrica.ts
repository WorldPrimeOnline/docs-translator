/**
 * Minimal Yandex Metrica event helpers — reachGoal wrappers only, no analytics
 * architecture beyond what's needed for the 4 funnel events (Traffic -> Upload ->
 * Quote -> Checkout -> Purchase). See src/components/analytics/YandexMetrica.tsx
 * for the counter init (production-gated, Webvisor/ecommerce disabled).
 *
 * Every export here is a safe no-op outside production (or before the counter
 * script has loaded) — callers never need to check that themselves.
 */

export const YANDEX_METRICA_PRODUCTION_HOSTNAME = 'www.wpotranslations.org';

type YandexGoalName = 'upload_completed' | 'quote_generated' | 'begin_checkout' | 'purchase';

export interface QuoteGeneratedParams {
  value: number;
  currency: string;
  service_level: string;
}

export interface BeginCheckoutParams {
  service_level: string;
}

export interface PurchaseParams {
  value: number;
  currency: string;
  service_level?: string;
}

function getCounterId(): number | null {
  const raw = process.env.NEXT_PUBLIC_YANDEX_METRICA_ID;
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

function isProductionHost(): boolean {
  return typeof window !== 'undefined' && window.location.hostname === YANDEX_METRICA_PRODUCTION_HOSTNAME;
}

function getYm(): ((...args: unknown[]) => void) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { ym?: (...args: unknown[]) => void };
  return typeof w.ym === 'function' ? w.ym : null;
}

function reachGoal(goalName: YandexGoalName, params?: object): void {
  const counterId = getCounterId();
  if (counterId === null || !isProductionHost()) return;
  const ym = getYm();
  if (!ym) return;
  ym(counterId, 'reachGoal', goalName, params);
}

// ─── pageviews (SPA navigation) ────────────────────────────────────────────────

// Same acquisition-param allowlist as src/lib/referral/capture.ts — the only
// existing "safe params for analytics" precedent in this codebase. Everything
// else (auth codes, payment/draft ids, tokens, error text) is dropped, never sent.
const SAFE_PAGEVIEW_PARAMS = ['ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

/** Strips every query param except the acquisition allowlist above — never PII/tokens/ids. */
export function sanitizePageviewUrl(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  const kept = new URLSearchParams();
  for (const key of SAFE_PAGEVIEW_PARAMS) {
    const value = params.get(key);
    if (value !== null) kept.set(key, value);
  }
  const query = kept.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/** Fire a single pageview hit. YandexMetrica.tsx initializes with defer: true, which
 * does NOT auto-send the initial pageview, so this is called for the first load too
 * (see YandexMetricaPageviews.tsx) — not SPA-navigation-only despite the name. */
export function trackPageview(url: string): void {
  const counterId = getCounterId();
  if (counterId === null || !isProductionHost()) return;
  const ym = getYm();
  if (!ym) return;
  ym(counterId, 'hit', url);
}

/** Fire only after a document upload has actually succeeded. No params — never filename/size/content. */
export function trackUploadCompleted(): void {
  reachGoal('upload_completed');
}

/** Fire only when a calculated price is actually shown to the user. */
export function trackQuoteGenerated(params: QuoteGeneratedParams): void {
  reachGoal('quote_generated', params);
}

/** Fire only when checkout/payment initiation has actually succeeded (never on a bare UI click). */
export function trackBeginCheckout(params: BeginCheckoutParams): void {
  reachGoal('begin_checkout', params);
}

// ─── purchase — max once per paid order ────────────────────────────────────────

const PURCHASE_DEDUP_PREFIX = 'wpo_ym_purchase_sent:';

function hasPurchaseBeenTracked(paymentId: string): boolean {
  try {
    return localStorage.getItem(PURCHASE_DEDUP_PREFIX + paymentId) === '1';
  } catch {
    return false;
  }
}

function markPurchaseTracked(paymentId: string): void {
  try {
    localStorage.setItem(PURCHASE_DEDUP_PREFIX + paymentId, '1');
  } catch {
    // localStorage unavailable (private mode etc.) — best-effort dedup only,
    // the event below still fires exactly once for this page load.
  }
}

/**
 * Fire `purchase` at most once per paymentId, ever (persisted in localStorage —
 * survives reloads/revisits to the result page). Call only from the authoritative
 * confirmed-paid branch (payment/result/page.tsx's status === 'paid' check) —
 * never on click, redirect, or pending/authorized state.
 */
export function trackPurchaseOnce(paymentId: string, params: PurchaseParams): void {
  if (hasPurchaseBeenTracked(paymentId)) return;
  markPurchaseTracked(paymentId);
  reachGoal('purchase', params);
}

// ─── service_level propagation: begin_checkout -> purchase ────────────────────
//
// The payment-status API (src/app/api/payments/halyk/status/[paymentId]/route.ts)
// doesn't currently return service_level, and this task deliberately avoids
// touching that payment-code file for a cosmetic analytics parameter. Instead,
// HalykPayButton stashes the service level (already known at that call site) into
// sessionStorage keyed by the real paymentId at begin_checkout time; the result
// page reads it back for the purchase event. Best-effort only: if storage is
// unavailable or the session was lost (different tab/device), the purchase event
// still fires with value/currency — service_level is simply omitted.

const SERVICE_LEVEL_PREFIX = 'wpo_ym_checkout_service_level:';

export function storeCheckoutServiceLevel(paymentId: string, serviceLevel: string): void {
  try {
    sessionStorage.setItem(SERVICE_LEVEL_PREFIX + paymentId, serviceLevel);
  } catch {
    // sessionStorage unavailable — purchase event will omit service_level
  }
}

export function readCheckoutServiceLevel(paymentId: string): string | null {
  try {
    return sessionStorage.getItem(SERVICE_LEVEL_PREFIX + paymentId);
  } catch {
    return null;
  }
}
