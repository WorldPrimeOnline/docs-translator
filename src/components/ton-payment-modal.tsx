'use client';

import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="shrink-0 text-xs text-primary hover:underline"
    >
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

export function TonPaymentModal({ documentId, jobId, onSuccess, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [details, setDetails] = useState<PaymentDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const secondsLeft = useCountdown(details?.expiresAt ?? null);

  // secondsLeft ticks every second — piggyback on it to re-evaluate cooldown
  const inCooldown = cooldownUntil !== null && Date.now() < cooldownUntil;

  // Fetch payment quote on mount
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

  // Expire when real timestamp passes (secondsLeft re-evaluates this every second)
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
      setCheckError('Payment not found yet, please wait a moment and try again.');
      setCooldownUntil(Date.now() + 10_000);
    } catch {
      setCheckError('Network error. Please try again.');
      setCooldownUntil(Date.now() + 10_000);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-md rounded-xl border bg-background p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          ✕
        </button>

        <h2 className="mb-1 text-lg font-semibold">Pay with TON</h2>

        {/* Loading */}
        {phase === 'loading' && (
          <p className="text-sm text-muted-foreground">Preparing payment…</p>
        )}

        {/* Error */}
        {phase === 'failed' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-destructive">{error ?? 'Something went wrong.'}</p>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex w-fit items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Close
            </button>
          </div>
        )}

        {/* Confirmed */}
        {phase === 'confirmed' && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="text-4xl">✓</span>
            <p className="font-medium text-green-600">Payment confirmed!</p>
            <p className="text-sm text-muted-foreground">Translation is starting…</p>
          </div>
        )}

        {/* Expired */}
        {phase === 'expired' && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-destructive">
              Payment window expired. Please upload your document again.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex w-fit items-center rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Close
            </button>
          </div>
        )}

        {/* Ready or waiting */}
        {(phase === 'ready' || phase === 'waiting') && details && (
          <div className="flex flex-col gap-5">
            {/* Amount */}
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-3xl font-bold">{details.amountTon} TON</p>
              <p className="text-sm text-muted-foreground">
                ≈ ${details.amountUsd} USD · 1 TON = ${details.tonPriceUsd}
              </p>
            </div>

            {phase === 'ready' && (
              <>
                {/* QR code — desktop only */}
                <div className="hidden md:flex flex-col items-center gap-2">
                  <QRCodeSVG value={deeplink} size={200} />
                  <p className="text-xs text-muted-foreground">Сканируйте камерой телефона</p>
                </div>

                {/* Deeplink button */}
                <button
                  type="button"
                  onClick={handlePayClick}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Pay with Tonkeeper
                </button>

                {/* Manual payment fallback */}
                <div className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
                  <p className="font-medium text-muted-foreground">Or pay manually:</p>

                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Address
                    </span>
                    <div className="flex items-center gap-2 rounded border bg-muted/40 px-3 py-2">
                      <code className="flex-1 truncate text-xs">{details.merchantAddress}</code>
                      <CopyButton text={details.merchantAddress} />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Amount
                    </span>
                    <div className="flex items-center gap-2 rounded border bg-muted/40 px-3 py-2">
                      <code className="flex-1 text-xs">{details.amountTon} TON</code>
                      <CopyButton text={details.amountTon} />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-xs uppercase tracking-wide text-muted-foreground">
                      Memo / Comment
                    </span>
                    <div className="flex items-center gap-2 rounded border bg-muted/40 px-3 py-2">
                      <code className="flex-1 truncate text-xs">{jobId}</code>
                      <CopyButton text={jobId} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Include this exact comment — it links your payment to the translation.
                    </p>
                  </div>
                </div>

                {/* Timer */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Time remaining</span>
                  <span
                    className={`font-mono font-medium ${secondsLeft < 120 ? 'text-destructive' : ''}`}
                  >
                    {fmt(secondsLeft)}
                  </span>
                </div>
              </>
            )}

            {phase === 'waiting' && (
              <div className="flex flex-col gap-4">
                {/* Timer */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Time remaining</span>
                  <span
                    className={`font-mono font-medium ${secondsLeft < 120 ? 'text-destructive' : ''}`}
                  >
                    {fmt(secondsLeft)}
                  </span>
                </div>

                {/* Failed check message */}
                {checkError && (
                  <p className="text-sm text-amber-600">{checkError}</p>
                )}

                {/* I've paid button */}
                <button
                  type="button"
                  onClick={() => void handleCheckClick()}
                  disabled={checking || inCooldown}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                >
                  {checking ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                      Checking payment…
                    </>
                  ) : (
                    "I've paid"
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPhase('ready');
                    setCheckError(null);
                    setCooldownUntil(null);
                  }}
                  className="text-center text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  Haven&apos;t paid yet? Go back
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
