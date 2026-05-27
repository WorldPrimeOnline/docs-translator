'use client';

import { useEffect, useState } from 'react';
import { X, Copy, Check, Loader2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslations } from 'next-intl';

interface PaymentDetails {
  paymentId: string;
  amountNanoton: number;
  amountTon: string;
  amountUsd: string;
  tonPriceUsd: string;
  merchantAddress: string;
  expiresAt: string;
}

type Phase = 'loading' | 'ready' | 'waiting' | 'confirmed' | 'failed' | 'expired';

interface Props {
  documentId: string;
  jobId: string;
  onSuccess: () => void;
  onClose: () => void;
}

function useCountdown(expiresAt: string | null): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!expiresAt) return;
    const tick = () =>
      setSeconds(Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return seconds;
}

function fmt(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-2 rounded-md border border-white/10 bg-background/60 px-3 py-2">
        <code className="flex-1 truncate text-xs text-foreground">{value}</code>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

export function TonPaymentModal({ documentId, jobId, onSuccess, onClose }: Props) {
  const t = useTranslations('payment');
  const [phase, setPhase] = useState<Phase>('loading');
  const [details, setDetails] = useState<PaymentDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const secondsLeft = useCountdown(details?.expiresAt ?? null);

  const inCooldown = cooldownUntil !== null && Date.now() < cooldownUntil;

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/payments/create-ton-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId, jobId }),
        });
        const data = (await res.json()) as PaymentDetails & { error?: string; detail?: string };
        if (!res.ok) {
          const msg =
            [data.error, data.detail].filter(Boolean).join(' — ') || 'Failed to create payment';
          setError(`${msg} (HTTP ${res.status})`);
          setPhase('failed');
          return;
        }
        setDetails(data);
        setPhase('ready');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Network error');
        setPhase('failed');
      }
    })();
  }, [documentId, jobId]);

  useEffect(() => {
    if ((phase === 'ready' || phase === 'waiting') && details) {
      if (Date.now() >= new Date(details.expiresAt).getTime()) {
        setPhase('expired');
      }
    }
  }, [secondsLeft, phase, details]);

  const deeplink = details
    ? `ton://transfer/${details.merchantAddress}?amount=${details.amountNanoton}&text=${encodeURIComponent(jobId)}`
    : '';

  function handlePayClick() {
    if (!details) return;
    window.open(deeplink, '_blank');
    setPhase('waiting');
  }

  async function handleCheckClick(): Promise<void> {
    if (checking || inCooldown) return;
    setChecking(true);
    setCheckError(null);
    try {
      const res = await fetch('/api/payments/verify-ton-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const data = (await res.json()) as { verified?: boolean; expired?: boolean };
      if (data.expired) {
        setPhase('expired');
        return;
      }
      if (data.verified) {
        setPhase('confirmed');
        setTimeout(onSuccess, 1500);
        return;
      }
      setCheckError(t('paymentNotFound'));
      setCooldownUntil(Date.now() + 10_000);
    } catch {
      setCheckError(t('networkError'));
      setCooldownUntil(Date.now() + 10_000);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center">
      <div className="relative w-full max-w-md rounded-lg border border-white/10 bg-card shadow-2xl shadow-black/50">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{t('title')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6">
          {/* Loading */}
          {phase === 'loading' && (
            <div className="flex items-center gap-3 py-4 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">{t('preparing')}</span>
            </div>
          )}

          {/* Error */}
          {phase === 'failed' && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-destructive">{error ?? t('errorFallback')}</p>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex w-fit items-center rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white/10"
              >
                {t('close')}
              </button>
            </div>
          )}

          {/* Confirmed */}
          {phase === 'confirmed' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
                <Check className="h-7 w-7 text-emerald-400" />
              </div>
              <p className="font-semibold text-foreground">{t('confirmed')}</p>
              <p className="text-sm text-muted-foreground">{t('translationStarting')}</p>
            </div>
          )}

          {/* Expired */}
          {phase === 'expired' && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">{t('expired')}</p>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex w-fit items-center rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white/10"
              >
                {t('close')}
              </button>
            </div>
          )}

          {/* Ready */}
          {phase === 'ready' && details && (
            <div className="flex flex-col gap-5">
              {/* Amount */}
              <div className="rounded-md border border-white/10 bg-background/60 p-4">
                <p className="text-3xl font-bold tracking-tight text-foreground">
                  {details.amountTon}{' '}
                  <span className="text-xl font-medium text-primary">TON</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  ≈ ${details.amountUsd} USD · 1 TON = ${details.tonPriceUsd}
                </p>
              </div>

              {/* QR code — desktop */}
              <div className="hidden flex-col items-center gap-3 md:flex">
                <div className="rounded-lg border border-white/10 bg-white p-3">
                  <QRCodeSVG value={deeplink} size={180} />
                </div>
                <p className="text-xs text-muted-foreground">{t('scanQr')}</p>
              </div>

              {/* Primary CTA */}
              <button
                type="button"
                onClick={handlePayClick}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
              >
                {t('openTonkeeper')}
              </button>

              {/* Manual payment */}
              <details className="group rounded-md border border-white/10">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-medium text-muted-foreground hover:text-foreground">
                  {t('payManually')}
                  <span className="transition-transform duration-200 group-open:rotate-180">▾</span>
                </summary>
                <div className="flex flex-col gap-3 border-t border-white/10 px-4 pb-4 pt-3">
                  <CopyField label={t('fieldAddress')} value={details.merchantAddress} />
                  <CopyField label={t('fieldAmount')} value={`${details.amountTon} TON`} />
                  <CopyField label={t('fieldMemo')} value={jobId} />
                  <p className="text-xs text-muted-foreground">{t('memoNote')}</p>
                </div>
              </details>

              {/* Timer */}
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t('timeRemaining')}</span>
                <span
                  className={`font-mono font-semibold ${secondsLeft < 120 ? 'text-destructive' : 'text-foreground'}`}
                >
                  {fmt(secondsLeft)}
                </span>
              </div>

              {/* Verify button */}
              {checkError && (
                <p className="text-xs text-amber-400">{checkError}</p>
              )}
              <button
                type="button"
                onClick={() => void handleCheckClick()}
                disabled={checking || inCooldown}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-white/15 bg-white/5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-white/10 disabled:pointer-events-none disabled:opacity-50"
              >
                {checking ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('checkingPayment')}
                  </>
                ) : (
                  t('verifyButton')
                )}
              </button>
            </div>
          )}

          {/* Waiting */}
          {phase === 'waiting' && details && (
            <div className="flex flex-col gap-5">
              <div className="rounded-md border border-white/10 bg-background/60 p-4">
                <p className="text-3xl font-bold tracking-tight text-foreground">
                  {details.amountTon}{' '}
                  <span className="text-xl font-medium text-primary">TON</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  ≈ ${details.amountUsd} USD
                </p>
              </div>

              <div className="flex flex-col items-center gap-4 py-4 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
                <p className="font-medium text-foreground">{t('waitingPayment')}</p>
                <p className="text-sm text-muted-foreground">{t('waitingDesc')}</p>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t('timeRemaining')}</span>
                <span
                  className={`font-mono font-semibold ${secondsLeft < 120 ? 'text-destructive' : 'text-foreground'}`}
                >
                  {fmt(secondsLeft)}
                </span>
              </div>

              {checkError && (
                <p className="text-xs text-amber-400">{checkError}</p>
              )}
              <button
                type="button"
                onClick={() => void handleCheckClick()}
                disabled={checking || inCooldown}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark disabled:pointer-events-none disabled:opacity-50"
              >
                {checking ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('checking')}
                  </>
                ) : (
                  t('verifyButton')
                )}
              </button>

              <button
                type="button"
                onClick={() => setPhase('ready')}
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                {t('goBack')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
