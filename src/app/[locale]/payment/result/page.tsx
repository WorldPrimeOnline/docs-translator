'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link } from '@/i18n/navigation';
import { Loader2, CheckCircle2, XCircle, Clock } from 'lucide-react';

type PaymentStatus =
  | 'payment_pending'
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'requires_review'
  | 'duplicate_charge_review';

interface PaymentStatusResponse {
  paymentId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  paidAt: string | null;
  failedAt: string | null;
  jobId: string | null;
}

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 20; // 60 seconds total

function isTerminal(status: PaymentStatus): boolean {
  return ['paid', 'failed', 'canceled', 'duplicate_charge_review'].includes(status);
}

export default function PaymentResultPage(): React.ReactElement {
  const t = useTranslations('payment');
  const searchParams = useSearchParams();
  const paymentId = searchParams.get('payment');

  const [status, setStatus] = useState<PaymentStatus | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [currency, setCurrency] = useState<string>('KZT');
  const [jobId, setJobId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [timedOut, setTimedOut] = useState(false);
  const pollCount = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async (): Promise<void> => {
    if (!paymentId) return;

    try {
      const response = await fetch(`/api/payments/halyk/status/${encodeURIComponent(paymentId)}`);
      if (!response.ok) {
        setLoading(false);
        return;
      }
      const data: PaymentStatusResponse = await response.json() as PaymentStatusResponse;
      setStatus(data.status);
      setAmount(data.amount);
      setCurrency(data.currency);
      setJobId(data.jobId);

      if (isTerminal(data.status) || pollCount.current >= MAX_POLLS) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (!isTerminal(data.status)) setTimedOut(true);
      }
    } catch {
      // Network error — keep polling
    } finally {
      setLoading(false);
      pollCount.current++;
    }
  }, [paymentId]);

  useEffect(() => {
    if (!paymentId) {
      setLoading(false);
      return;
    }

    // Initial fetch immediately
    void fetchStatus();

    // Then poll
    intervalRef.current = setInterval(() => {
      if (pollCount.current >= MAX_POLLS) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setTimedOut(true);
        return;
      }
      void fetchStatus();
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchStatus, paymentId]);

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

  if (status === 'paid') {
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

  if (status === 'failed' || status === 'canceled') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <XCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">{t('failedTitle')}</h1>
          <p className="text-muted-foreground mb-6">{t('failedDesc')}</p>
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

  if (status === 'requires_review' || status === 'duplicate_charge_review') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <Clock className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">{t('reviewTitle')}</h1>
          <p className="text-muted-foreground mb-6">{t('reviewDesc')}</p>
          <Link href="/dashboard" className="text-blue-400 hover:underline">{t('goToDashboard')}</Link>
        </div>
      </div>
    );
  }

  // payment_pending or timed out
  if (timedOut) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <Clock className="w-16 h-16 text-yellow-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">{t('processingTitle')}</h1>
          <p className="text-muted-foreground mb-6">{t('processingDesc')}</p>
          <Link href="/dashboard" className="text-blue-400 hover:underline">{t('goToDashboard')}</Link>
        </div>
      </div>
    );
  }

  // Still polling
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-blue-400" />
        <p className="text-muted-foreground">{t('processingPayment')}</p>
      </div>
    </div>
  );
}
