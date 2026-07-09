'use client';

import React, { useState, useRef, useCallback, useLayoutEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { CreditCard, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import type { HalykPayBootstrap, HalykPaymentObject } from '@/lib/payments/halyk/types';

// TypeScript declaration for the Halyk SDK injected into window
declare global {
  interface Window {
    halyk?: {
      pay: (paymentObject: HalykPaymentObject) => void;
    };
  }
}

type ButtonState = 'idle' | 'loading' | 'script_loading' | 'error' | 'paid';

interface Props {
  jobId: string;
  quoteId: string;
  priceKzt: number;
  className?: string;
  onSuccess?: (paymentId: string) => void;
  /** Skip the idle click and start the payment flow immediately on mount (used by one-step checkout). */
  autoStart?: boolean;
  /** Overrides the loading-state label while autoStart is in flight. */
  loadingLabel?: string;
}

export function HalykPayButton({ jobId, quoteId, priceKzt, className = '', onSuccess, autoStart = false, loadingLabel }: Props): React.ReactElement {
  const t = useTranslations('payment');
  const locale = useLocale();
  const [state, setState] = useState<ButtonState>('idle');
  const [errorKey, setErrorKey] = useState<string>('genericError');
  const initiated = useRef(false);
  const scriptLoaded = useRef(false);

  const loadScript = useCallback((scriptUrl: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (scriptLoaded.current || document.querySelector(`script[src="${scriptUrl}"]`)) {
        scriptLoaded.current = true;
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      script.onload = () => {
        scriptLoaded.current = true;
        resolve();
      };
      script.onerror = () => reject(new Error('Failed to load payment script'));
      document.head.appendChild(script);
    });
  }, []);

  const handlePay = useCallback(async (): Promise<void> => {
    // Prevent double invocation (double-click, React StrictMode)
    if (initiated.current || state === 'loading' || state === 'script_loading' || state === 'paid') {
      return;
    }
    initiated.current = true;

    setState('loading');
    setErrorKey('genericError');

    let bootstrap: HalykPayBootstrap;

    try {
      const response = await fetch('/api/payments/halyk/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, quoteId, locale }),
        credentials: 'same-origin',
      });

      if (!response.ok) {
        let errorCode: string | undefined;
        try { errorCode = (await response.json() as { error?: string }).error; } catch { /* ignore */ }
        if (response.status === 503) setErrorKey('unavailable');
        else if (response.status === 502) setErrorKey('gatewayError');
        else if (response.status === 409) {
          setErrorKey(errorCode === 'PAYMENT_ALREADY_PENDING' ? 'alreadyPaid' : 'alreadyPaid');
        }
        else if (response.status === 401) setErrorKey('sessionExpired');
        else if (response.status === 422 && errorCode && ['QUOTE_EXPIRED', 'QUOTE_ALREADY_PAID', 'QUOTE_JOB_MISMATCH', 'QUOTE_NOT_FOUND', 'PRICING_NOT_CONFIGURED', 'NOTARY_CUTOFF_PASSED'].includes(errorCode)) {
          setErrorKey(errorCode);
        }
        else setErrorKey('genericError');
        setState('error');
        initiated.current = false;
        return;
      }

      bootstrap = await response.json() as HalykPayBootstrap;
    } catch {
      setErrorKey('networkError');
      setState('error');
      initiated.current = false;
      return;
    }

    // Load the Halyk script
    setState('script_loading');

    try {
      await loadScript(bootstrap.scriptUrl);
    } catch {
      setErrorKey('scriptError');
      setState('error');
      initiated.current = false;
      return;
    }

    // Verify halyk.pay is available
    if (typeof window.halyk?.pay !== 'function') {
      setErrorKey('scriptError');
      setState('error');
      initiated.current = false;
      return;
    }

    // Invoke payment — user will be redirected to Halyk hosted page
    window.halyk.pay(bootstrap.paymentObject);

    // After halyk.pay() returns (or redirect), notify parent
    if (onSuccess) {
      onSuccess(bootstrap.paymentId);
    }
  }, [jobId, quoteId, locale, loadScript, onSuccess, state]);

  const handleRetry = useCallback((): void => {
    initiated.current = false;
    setState('idle');
  }, []);

  // Layout effect (fires before paint) so the loading state is applied before
  // the idle "pay" button ever renders — avoids a one-frame flash of a second button.
  useLayoutEffect(() => {
    if (autoStart) void handlePay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state === 'paid') {
    return (
      <div className="flex items-center gap-2 text-primary text-sm font-medium">
        <span>{t('paid')}</span>
      </div>
    );
  }

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

  const isLoading = state === 'loading' || state === 'script_loading';

  return (
    <button
      type="button"
      onClick={() => void handlePay()}
      disabled={isLoading}
      className={`inline-flex items-center justify-center gap-2 rounded-md bg-primary hover:bg-gold-dark disabled:pointer-events-none disabled:opacity-50 text-primary-foreground font-semibold px-5 py-2.5 transition-colors text-sm ${className}`}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : (
        <CreditCard className="w-4 h-4" />
      )}
      {isLoading
        ? (loadingLabel ?? t('processing'))
        : t('payButton', { amount: priceKzt.toLocaleString(), currency: 'KZT' })}
    </button>
  );
}
