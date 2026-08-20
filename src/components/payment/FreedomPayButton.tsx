'use client';

import React, { useState, useRef, useCallback, useLayoutEffect } from 'react';
import { useTranslations } from 'next-intl';
import { CreditCard, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { trackBeginCheckout, storeCheckoutServiceLevel } from '@/lib/analytics/yandex-metrica';

type ButtonState = 'idle' | 'loading' | 'error';

interface Props {
  jobId: string;
  quoteId: string;
  priceKzt: number;
  className?: string;
  /** Skip the idle click and start the payment flow immediately on mount — mirrors
   * HalykPayButton's autoStart, used by the automatic one-step checkout flow. */
  autoStart?: boolean;
  /** Overrides the loading-state label while autoStart is in flight. */
  loadingLabel?: string;
  /** Analytics label only (Yandex Metrica begin_checkout/purchase) — never used for pricing/business logic. */
  serviceLevel?: string;
}

interface FreedomPayInitiateResponse {
  paymentId: string;
  redirectUrl: string;
}

/**
 * Not gated by BUSINESS_PROFILE.cardPaymentsActive (Halyk-only) or a NEXT_PUBLIC_*
 * flag — the server-side FREEDOMPAY_ENABLED gate is the only control; if disabled,
 * /initiate returns 503 and this renders the same "unavailable" state as a normal
 * error. No client-side script to load — Freedom Pay's hosted page is a plain
 * redirect, unlike Halyk's payform script.
 *
 * Which provider the automatic checkout renders (this vs HalykPayButton) is decided
 * by src/lib/payments/checkout-provider.ts, not by this component itself.
 */
export function FreedomPayButton({ jobId, quoteId, priceKzt, className = '', onSuccess, autoStart = false, loadingLabel, serviceLevel }: Props & { onSuccess?: (paymentId: string) => void }): React.ReactElement {
  const t = useTranslations('payment');
  const [state, setState] = useState<ButtonState>('idle');
  const [errorKey, setErrorKey] = useState<string>('genericError');
  const initiated = useRef(false);

  const handlePay = useCallback(async (): Promise<void> => {
    if (initiated.current || state === 'loading') return;
    initiated.current = true;
    setState('loading');
    setErrorKey('genericError');

    let bootstrap: FreedomPayInitiateResponse;

    try {
      const response = await fetch('/api/payments/freedompay/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, quoteId }),
        credentials: 'same-origin',
      });

      if (!response.ok) {
        let errorCode: string | undefined;
        try { errorCode = (await response.json() as { error?: string }).error; } catch { /* ignore */ }
        if (response.status === 503) setErrorKey('unavailable');
        else if (response.status === 502) setErrorKey('gatewayError');
        else if (response.status === 409) setErrorKey('alreadyPaid');
        else if (response.status === 401) setErrorKey('sessionExpired');
        else if (response.status === 422 && errorCode && ['QUOTE_EXPIRED', 'QUOTE_ALREADY_PAID', 'QUOTE_JOB_MISMATCH', 'QUOTE_NOT_FOUND'].includes(errorCode)) {
          setErrorKey(errorCode);
        } else setErrorKey('genericError');
        setState('error');
        initiated.current = false;
        return;
      }

      bootstrap = await response.json() as FreedomPayInitiateResponse;
    } catch {
      setErrorKey('networkError');
      setState('error');
      initiated.current = false;
      return;
    }

    // Checkout has genuinely started here — /initiate succeeded and we're committed to
    // the Freedom Pay redirect below. Mirrors HalykPayButton's identical tracking point.
    trackBeginCheckout({ service_level: serviceLevel ?? 'unknown' });
    storeCheckoutServiceLevel(bootstrap.paymentId, serviceLevel ?? 'unknown');

    if (onSuccess) onSuccess(bootstrap.paymentId);

    window.location.href = bootstrap.redirectUrl;
  }, [jobId, quoteId, state, onSuccess, serviceLevel]);

  const handleRetry = useCallback((): void => {
    initiated.current = false;
    setState('idle');
  }, []);

  // Layout effect (fires before paint) so the loading state is applied before the
  // idle "pay" button ever renders — avoids a one-frame flash, mirrors HalykPayButton.
  useLayoutEffect(() => {
    if (autoStart) void handlePay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'error') {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{t(errorKey)}</span>
        </div>
        <button
          type="button"
          onClick={handleRetry}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          {t('retry')}
        </button>
      </div>
    );
  }

  const isLoading = state === 'loading';

  return (
    <button
      type="button"
      onClick={() => void handlePay()}
      disabled={isLoading}
      className={`inline-flex items-center justify-center gap-2 rounded-md bg-primary hover:bg-gold-dark disabled:pointer-events-none disabled:opacity-50 text-primary-foreground font-semibold px-5 py-2.5 transition-colors text-sm ${className}`}
    >
      {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
      {isLoading
        ? (loadingLabel ?? t('processing'))
        : t('payButton', { amount: priceKzt.toLocaleString(), currency: 'KZT' })}
    </button>
  );
}
