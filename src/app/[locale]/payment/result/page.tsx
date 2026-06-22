'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { Loader2, CheckCircle2, XCircle, Clock, RefreshCw } from 'lucide-react';

// Public payment statuses — matches PublicPaymentStatus in status-map.ts.
// Internal-only statuses (requires_review, duplicate_charge_review) are never returned by the API.
type PaymentStatus =
  | 'payment_pending'
  | 'authorized'
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'expired'
  | 'refunded'
  | 'unknown';

interface PaymentStatusResponse {
  paymentId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  paidAt: string | null;
  failedAt: string | null;
  jobId: string | null;
  isTerminal?: boolean;
  isSuccess?: boolean;
  isFailure?: boolean;
  isAuthorized?: boolean;
  canRetryPayment?: boolean;
  skippedProviderCheck?: boolean;
  messageCode?: string | null;
  nextProviderCheckAfter?: string | null;
  lastCheckedAt?: string | null;
}

const POLL_INTERVAL_MS = 4000;
const MAX_AUTO_POLL_MS = 90_000;
const PENDING_LONG_THRESHOLD_MS = 30_000;

function isTerminalStatus(status: PaymentStatus): boolean {
  return ['paid', 'failed', 'canceled', 'expired', 'refunded', 'unknown'].includes(status);
}

export default function PaymentResultPage(): React.ReactElement {
  const t = useTranslations('payment');
  const searchParams = useSearchParams();
  const paymentId = searchParams.get('payment');

  const [response, setResponse] = useState<PaymentStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const [manualChecking, setManualChecking] = useState(false);
  const startTimeRef = useRef(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmountedRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async (): Promise<PaymentStatusResponse | null> => {
    if (!paymentId || unmountedRef.current) return null;
    try {
      const res = await fetch(`/api/payments/halyk/status/${encodeURIComponent(paymentId)}`);
      if (!res.ok) return null;
      return await res.json() as PaymentStatusResponse;
    } catch {
      return null;
    }
  }, [paymentId]);

  const startInterval = useCallback(() => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      if (elapsed >= MAX_AUTO_POLL_MS) {
        stopPolling();
        setTimedOut(true);
        return;
      }
      if (document.visibilityState === 'hidden') return;
      void (async () => {
        const data = await fetchStatus();
        if (!unmountedRef.current && data) {
          setResponse(data);
          if (isTerminalStatus(data.status) || (data.isTerminal ?? false)) stopPolling();
        }
      })();
    }, POLL_INTERVAL_MS);
  }, [fetchStatus, stopPolling]);

  useEffect(() => {
    if (!paymentId) {
      setLoading(false);
      return;
    }
    unmountedRef.current = false;
    void (async () => {
      const data = await fetchStatus();
      if (unmountedRef.current) return;
      if (data) setResponse(data);
      setLoading(false);
      if (!data || !(isTerminalStatus(data.status) || (data.isTerminal ?? false))) {
        startInterval();
      }
    })();
    return () => {
      unmountedRef.current = true;
      stopPolling();
    };
  }, [fetchStatus, paymentId, startInterval, stopPolling]);

  const handleManualCheck = useCallback(async () => {
    setManualChecking(true);
    setTimedOut(false);
    const data = await fetchStatus();
    if (data) {
      setResponse(data);
      if (isTerminalStatus(data.status) || (data.isTerminal ?? false)) {
        stopPolling();
      } else {
        startTimeRef.current = Date.now();
        startInterval();
      }
    }
    setManualChecking(false);
  }, [fetchStatus, startInterval, stopPolling]);

  if (!paymentId) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-semibold mb-2">{t('invalidLink')}</h1>
          <Link href="/dashboard" className="text-blue-400 hover:underline">{t('goToDashboard')}</Link>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-blue-400" />
          <p className="text-muted-foreground">{t('checkingStatus')}</p>
        </div>
      </div>
    );
  }

  const status = response?.status ?? 'payment_pending';
  const amount = response?.amount ?? null;
  const currency = response?.currency ?? 'KZT';
  const jobId = response?.jobId ?? null;
  const canRetry = response?.canRetryPayment ?? false;
  const isAuthorized = response?.isAuthorized ?? false;

  if (status === 'paid' || response?.isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">{t('successTitle')}</h1>
          <p className="text-muted-foreground mb-6">
            {t('successDesc', { amount: `${amount?.toLocaleString()} ${currency}` })}
          </p>
          {jobId && (
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg px-5 py-2.5 font-medium transition-colors"
            >
              {t('viewOrder')}
            </Link>
          )}
        </div>
      </div>
    );
  }

  if (status === 'failed' || status === 'canceled' || status === 'expired' || response?.isFailure) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md space-y-4">
          <XCircle className="w-16 h-16 text-red-400 mx-auto" />
          <h1 className="text-2xl font-bold">{t('failedTitle')}</h1>
          <p className="text-muted-foreground">{t('failedDesc')}</p>
          {jobId && canRetry && (
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-5 py-2.5 font-medium transition-colors"
            >
              {t('retryPayment')}
            </Link>
          )}
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-lg px-5 py-2.5 font-medium transition-colors"
          >
            {t('goToDashboard')}
          </Link>
        </div>
      </div>
    );
  }

  // authorized: pre-authorized payment, Halyk will auto-capture (1-step flow)
  if (status === 'authorized' || isAuthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md space-y-4">
          <Loader2 className="w-12 h-12 animate-spin mx-auto text-blue-400" />
          <h1 className="text-xl font-semibold">{t('authorizedTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('authorizedDesc')}</p>
        </div>
      </div>
    );
  }

  // unknown: internal review state or unrecognized status — do not leave the user stranded
  if (status === 'unknown') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md space-y-4">
          <Clock className="w-16 h-16 text-yellow-400 mx-auto" />
          <h1 className="text-2xl font-bold">{t('reviewTitle')}</h1>
          <p className="text-muted-foreground">{t('reviewDesc')}</p>
          <Link href="/dashboard" className="text-blue-400 hover:underline">{t('goToDashboard')}</Link>
        </div>
      </div>
    );
  }

  if (timedOut) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md space-y-4">
          <Clock className="w-16 h-16 text-amber-400 mx-auto" />
          <h1 className="text-2xl font-bold">{t('delayedTitle')}</h1>
          <p className="text-muted-foreground">{t('delayedDesc')}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mt-2">
            <button
              onClick={() => void handleManualCheck()}
              disabled={manualChecking}
              className="inline-flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-lg px-5 py-2.5 font-medium transition-colors disabled:opacity-50"
            >
              {manualChecking
                ? <><Loader2 className="w-4 h-4 animate-spin" />{t('checkingStatus')}</>
                : <><RefreshCw className="w-4 h-4" />{t('checkAgain')}</>
              }
            </button>
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 rounded-lg px-5 py-2.5 font-medium transition-colors"
            >
              {t('goToDashboard')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Still polling — show spinner; after 30s switch to "taking longer" message
  const elapsed = Date.now() - startTimeRef.current;
  const isPendingLong = elapsed > PENDING_LONG_THRESHOLD_MS;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center max-w-md space-y-4">
        <Loader2 className="w-12 h-12 animate-spin mx-auto text-blue-400" />
        <h1 className="text-xl font-semibold">
          {isPendingLong ? t('pendingLongTitle') : t('processingPayment')}
        </h1>
        {isPendingLong && (
          <p className="text-sm text-muted-foreground">{t('pendingLongDesc')}</p>
        )}
        {isPendingLong && (
          <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-foreground underline">
            {t('goToDashboard')}
          </Link>
        )}
      </div>
    </div>
  );
}
