'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { HalykPayButton } from '@/components/payment/HalykPayButton';
import { Link } from '@/i18n/navigation';

interface DraftSummary {
  source_language: string | null;
  target_language: string | null;
  document_type: string | null;
  service_level: string | null;
  pricing_snapshot: {
    result: { amountKzt: number; currency: string };
    priceBeforeDiscountKzt?: number;
    discountAppliedKzt?: number;
    discountCode?: string | null;
  } | null;
}

interface ConvertedOrder {
  jobId: string;
  quoteId: string;
  priceKzt: number;
}

export function CheckoutClient() {
  const searchParams = useSearchParams();
  const draftId = searchParams.get('draftId');
  const t = useTranslations('startWizard');
  const paymentT = useTranslations('payment');

  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DraftSummary | null>(null);
  const [termsChecked, setTermsChecked] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [order, setOrder] = useState<ConvertedOrder | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

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
      setDraft(data.draft);
      setLoading(false);
    })();
  }, [draftId]);

  const handleConfirm = async (): Promise<void> => {
    if (!draftId || !termsChecked) return;
    setConfirming(true);
    setErrorKey(null);

    const acceptRes = await fetch('/api/users/accept-terms', { method: 'POST' });
    if (!acceptRes.ok) { setErrorKey('genericError'); setConfirming(false); return; }

    const convertRes = await fetch(`/api/order-drafts/${draftId}/convert`, { method: 'POST' });
    const data = await convertRes.json() as ConvertedOrder & { error?: string };
    if (!convertRes.ok || !data.jobId || !data.quoteId) {
      setErrorKey('genericError');
      setConfirming(false);
      return;
    }

    setOrder({ jobId: data.jobId, quoteId: data.quoteId, priceKzt: data.priceKzt });
    setConfirming(false);
  };

  if (loading) {
    return (
      <div className="mx-auto flex max-w-lg items-center justify-center gap-2 rounded-lg border border-white/10 bg-card p-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('loadingDraft')}
      </div>
    );
  }

  if (errorKey || !draft) {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-white/10 bg-card p-6 text-center">
        <p className="mb-4 text-sm text-foreground">{t(errorKey ?? 'draftNotFound')}</p>
        <Link href="/start" className="text-sm text-primary underline underline-offset-4">{t('backToStart')}</Link>
      </div>
    );
  }

  const priceKzt = order?.priceKzt ?? Math.round(draft.pricing_snapshot?.result.amountKzt ?? 0);
  const currency = draft.pricing_snapshot?.result.currency ?? 'KZT';
  const discountAppliedKzt = draft.pricing_snapshot?.discountAppliedKzt;
  const priceBeforeDiscountKzt = draft.pricing_snapshot?.priceBeforeDiscountKzt;
  const discountCode = draft.pricing_snapshot?.discountCode;

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-white/10 bg-card p-6">
      <h2 className="mb-1 text-lg font-semibold text-foreground">{t('checkoutTitle')}</h2>
      <p className="mb-5 text-sm text-muted-foreground">{t('checkoutSubtitle')}</p>

      <div className="mb-5 rounded-lg border border-primary/30 bg-primary/5 p-5 text-center">
        {discountAppliedKzt && discountAppliedKzt > 0 && priceBeforeDiscountKzt ? (
          <div className="mb-1 text-sm text-muted-foreground line-through">
            {priceBeforeDiscountKzt.toLocaleString()} {currency}
          </div>
        ) : null}
        <div className="text-3xl font-extrabold text-foreground">
          {priceKzt.toLocaleString()} {currency}
        </div>
        {discountAppliedKzt && discountAppliedKzt > 0 && discountCode ? (
          <div className="mt-1 text-xs font-medium text-emerald-400">
            {t('discountApplied', { amount: discountAppliedKzt.toLocaleString(), code: discountCode })}
          </div>
        ) : null}
      </div>

      {order ? (
        <HalykPayButton
          jobId={order.jobId}
          quoteId={order.quoteId}
          priceKzt={priceKzt}
          className="w-full"
          autoStart
          loadingLabel={paymentT('redirectingToPayment')}
        />
      ) : (
        <>
          <label className="mb-4 flex items-start gap-2.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={termsChecked} onChange={(e) => setTermsChecked(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-white/20" />
            {t('termsCheckboxLabel')}
          </label>

          {errorKey && <p className="mb-3 text-xs text-red-400">{t(errorKey)}</p>}

          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={!termsChecked || confirming}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark disabled:pointer-events-none disabled:opacity-50"
          >
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirming ? paymentT('redirectingToPayment') : paymentT('payButton', { amount: priceKzt.toLocaleString(), currency: 'KZT' })}
          </button>
        </>
      )}
    </div>
  );
}
