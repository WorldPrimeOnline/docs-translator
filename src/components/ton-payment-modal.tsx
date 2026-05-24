'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TonConnectButton, useTonAddress, useTonConnectUI } from '@tonconnect/ui-react';

interface PaymentDetails {
  paymentId: string;
  amountNanoton: number;
  amountTon: string;
  amountUsd: string;
  tonPriceUsd: string;
  merchantAddress: string;
  memo: string;
  payload: string;
  expiresAt: string;
}

type Phase = 'loading' | 'ready' | 'sending' | 'waiting' | 'confirmed' | 'failed' | 'expired';

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
    const tick = () => {
      const diff = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSeconds(diff);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  return seconds;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = (seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function TonPaymentModal({ documentId, jobId, onSuccess, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [details, setDetails] = useState<PaymentDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [tonConnectUI] = useTonConnectUI();
  const walletAddress = useTonAddress();
  const secondsLeft = useCountdown(details?.expiresAt ?? null);

  // Fetch payment details on mount
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
          const msg = [data.error, data.detail].filter(Boolean).join(' — ') || 'Failed to create payment';
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

  const pollVerify = useCallback(
    async (paymentId: string) => {
      try {
        const res = await fetch('/api/payments/verify-ton-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paymentId }),
        });
        const data = (await res.json()) as { verified?: boolean; expired?: boolean };
        if (data.expired) {
          if (pollRef.current) clearInterval(pollRef.current);
          setPhase('expired');
          return;
        }
        if (data.verified) {
          if (pollRef.current) clearInterval(pollRef.current);
          setPhase('confirmed');
          setTimeout(onSuccess, 1500);
        }
      } catch {
        // silently retry
      }
    },
    [onSuccess],
  );

  // Start polling when in waiting phase
  useEffect(() => {
    if (phase === 'waiting' && details) {
      pollRef.current = setInterval(() => {
        void pollVerify(details.paymentId);
      }, 5000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [phase, details, pollVerify]);

  // Expire only when the actual timestamp has passed — NOT when secondsLeft===0,
  // because secondsLeft initialises to 0 before the first countdown tick fires.
  useEffect(() => {
    if ((phase === 'ready' || phase === 'waiting') && details) {
      if (Date.now() >= new Date(details.expiresAt).getTime()) {
        if (pollRef.current) clearInterval(pollRef.current);
        setPhase('expired');
      }
    }
  }, [secondsLeft, phase, details]);

  async function handleSend() {
    if (!details || !walletAddress) return;
    setPhase('sending');
    try {
      await tonConnectUI.sendTransaction({
        validUntil: Math.floor(new Date(details.expiresAt).getTime() / 1000),
        messages: [
          {
            address: details.merchantAddress,
            amount: details.amountNanoton.toString(),
            payload: details.payload,
          },
        ],
      });
      setPhase('waiting');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('reject') || msg.toLowerCase().includes('cancel')) {
        setPhase('ready');
      } else {
        setError(msg);
        setPhase('failed');
      }
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
        <p className="mb-5 text-sm text-muted-foreground">
          Connect your TON wallet (e.g. Tonkeeper). The amount and memo are
          filled automatically — just confirm in your wallet app.
        </p>

        {phase === 'loading' && (
          <p className="text-sm text-muted-foreground">Preparing payment…</p>
        )}

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

        {phase === 'confirmed' && (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <span className="text-4xl">✓</span>
            <p className="font-medium text-green-600">Payment confirmed!</p>
            <p className="text-sm text-muted-foreground">Translation is starting…</p>
          </div>
        )}

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

        {(phase === 'ready' || phase === 'sending' || phase === 'waiting') && details && (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border bg-muted/40 p-4">
              <p className="text-2xl font-bold">{details.amountTon} TON</p>
              <p className="text-sm text-muted-foreground">
                ≈ ${details.amountUsd} USD · 1 TON = ${details.tonPriceUsd}
              </p>
            </div>

            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Memo / Comment (required)
              </p>
              <div className="flex items-center gap-2 rounded border bg-muted/40 px-3 py-2">
                <code className="flex-1 truncate text-xs">{details.memo}</code>
                <button
                  type="button"
                  onClick={() => void navigator.clipboard.writeText(details.memo)}
                  className="shrink-0 text-xs text-primary hover:underline"
                >
                  Copy
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                Automatically included by your wallet — do not change it.
              </p>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Time remaining</span>
              <span
                className={`font-mono font-medium ${secondsLeft < 120 ? 'text-destructive' : 'text-foreground'}`}
              >
                {formatCountdown(secondsLeft)}
              </span>
            </div>

            <div className="flex flex-col gap-3">
              <TonConnectButton />

              {walletAddress && phase !== 'waiting' && (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={phase === 'sending'}
                  className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
                >
                  {phase === 'sending' ? 'Confirm in wallet…' : `Send ${details.amountTon} TON`}
                </button>
              )}

              {phase === 'waiting' && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Verifying payment…
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
