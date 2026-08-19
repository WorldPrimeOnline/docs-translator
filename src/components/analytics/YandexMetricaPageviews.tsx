'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { sanitizePageviewUrl, trackPageview } from '@/lib/analytics/yandex-metrica';

/**
 * SPA pageview tracking for Next.js App Router — Yandex Metrica's tag.js has no
 * built-in History-API listener (unlike GA4's gtag.js), so this is the manual
 * equivalent of what @next/third-parties' GoogleAnalytics gets automatically.
 *
 * YandexMetrica.tsx initializes with defer: true, which — unlike a normal init —
 * does NOT automatically send the initial pageview hit. So this component fires a
 * hit on every render including the first one; the ref below only collapses
 * duplicate re-renders for the SAME url (React Strict Mode double-invoke, unrelated
 * state updates) into a single hit, it never skips a genuinely new url. Net result:
 * exactly one hit on first load, exactly one hit per real client-side navigation.
 *
 * Rendered inside a <Suspense> boundary in src/app/layout.tsx — required by
 * Next.js whenever a Client Component calls useSearchParams() (same pattern
 * already used for <ReferralCapture /> in src/app/[locale]/layout.tsx).
 */
export function YandexMetricaPageviews(): null {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastTrackedUrl = useRef<string | null>(null);

  useEffect(() => {
    const url = sanitizePageviewUrl(pathname, searchParams.toString());

    if (lastTrackedUrl.current === url) return;
    lastTrackedUrl.current = url;
    trackPageview(url);
  }, [pathname, searchParams]);

  return null;
}
