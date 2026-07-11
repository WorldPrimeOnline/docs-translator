'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { HalykPayButton } from '@/components/payment/HalykPayButton';
import { Link } from '@/i18n/navigation';

interface DraftSummary {
  consent_accepted_at: string | null;
}

interface ConvertedOrder {
  jobId: string;
  quoteId: string;
  priceKzt: number;
}

/**
 * Draft checkout is a payment BRIDGE, not a second confirmation screen. The /start
 * price-ready panel (OrderWizard.tsx) is the only place a customer reviews
 * price/discount/terms for the public draft flow — by the time they land here (after
 * the /start "Continue to payment" -> login redirect), consent was already recorded
 * on the draft itself (order_drafts.consent_accepted_at, set from the /start submit —
 * see migration 0047 and OrderForm.tsx's publicStart payload). This component's only
 * job is: verify that recorded consent, auto-convert the draft, and auto-start Halyk —
 * it must never re-render a confirm/terms/pay screen. See
 * docs/ai-context/50_PAYMENTS_FINANCE_FISCALIZATION.md.
 *
 * If consent was never recorded (e.g. a pre-migration or otherwise malformed draft),
 * this refuses to silently continue — it shows an error and links back to /start.
 * convertDraftToOrder() enforces the same check server-side as the real guarantee;
 * this client-side check is only what decides what to render.
 */
export function CheckoutClient() {
  const searchParams = useSearchParams();
  const draftId = searchParams.get('draftId');
  const t = useTranslations('startWizard');
  const paymentT = useTranslations('payment');

  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftSummary | null>(null);
  const [order, setOrder] = useState<ConvertedOrder | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // Guards against a double-call on re-render (StrictMode, effect re-run) — the server
  // side is also idempotent (convertDraftToOrder's atomic claim), but this avoids firing
  // a redundant request in the first place.
  const convertStarted = useRef(false);

  useEffect(() => {
    if (!draftId) { setLoading(false); setErrorKey('draftNotFound'); return; }

    void (async () => {
      const attachRes = await fetch(`/api/order-drafts/${draftId}/attach`, { method: 'POST' });
      if (!attachRes.ok && attachRes.status !== 200) {
        // Non-fatal if already attached; only bail on a hard ownership conflict
        const data = await attachRes.json().catch(() => ({})) as { error?: string };
        if (data.error === 'DRAFT_OWNED_BY_ANOTHER_USER' || data.error === 'SESSION_MISMATCH') {
          setErrorKey('draftNotFound');
          setLoading(false);
          return;
        }
      }

      const getRes = await fetch(`/api/order-drafts/${draftId}`);
      if (!getRes.ok) { setErrorKey('draftNotFound'); setLoading(false); return; }
      const data = await getRes.json() as { draft: DraftSummary };

      if (!data.draft.consent_accepted_at) {
        setErrorKey('consentMissing');
        setLoading(false);
        return;
      }

      setDraft(data.draft);
      setLoading(false);
    })();
  }, [draftId]);

  // Auto-convert as soon as a consented draft has loaded — there is no user click to
  // wait for here, this is a bridge, not a second confirmation step.
  useEffect(() => {
    if (!draft || !draftId || order || errorKey || convertStarted.current) return;
    convertStarted.current = true;

    void (async () => {
      const convertRes = await fetch(`/api/order-drafts/${draftId}/convert`, { method: 'POST' });
      const data = await convertRes.json() as ConvertedOrder & { error?: string };
      if (!convertRes.ok || !data.jobId || !data.quoteId) {
        setErrorKey('checkoutError');
        convertStarted.current = false;
        return;
      }
      setOrder({ jobId: data.jobId, quoteId: data.quoteId, priceKzt: data.priceKzt });
    })();
  }, [draft, draftId, order, errorKey]);

  if (errorKey === 'consentMissing' || errorKey === 'draftNotFound' || errorKey === 'checkoutError') {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-white/10 bg-card p-6 text-center">
        <p className="mb-4 text-sm text-foreground">{t(errorKey)}</p>
        <Link href="/start" className="text-sm text-primary underline underline-offset-4">{t('backToStart')}</Link>
      </div>
    );
  }

  if (!order) {
    // Covers: initial draft load, and the gap between a consented draft loading and
    // conversion completing — a single continuous bridge screen, same text throughout.
    return (
      <div className="mx-auto flex max-w-lg items-center justify-center gap-2 rounded-lg border border-white/10 bg-card p-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {loading ? t('loadingDraft') : paymentT('redirectingToPayment')}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-white/10 bg-card p-6 text-center">
      <HalykPayButton
        jobId={order.jobId}
        quoteId={order.quoteId}
        priceKzt={order.priceKzt}
        className="w-full"
        autoStart
        loadingLabel={paymentT('redirectingToPayment')}
      />
    </div>
  );
}
