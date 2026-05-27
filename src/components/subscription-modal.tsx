'use client';

import { useEffect, useState } from 'react';
import { X, Copy, Check, Loader2, Zap, Star } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslations } from 'next-intl';

type Phase =
  | 'choose'
  | 'loading'
  | 'ready'
  | 'waiting'
  | 'polling'
  | 'confirmed'
  | 'failed';

interface PaymentDetails {
  subscriptionId: string;
  amountTon: string;
  amountNanoton: number;
  amountUsd: string;
  tonPriceUsd: string;
  walletAddress: string;
  deeplink: string;
  qrData: string;
  plan: 'basic' | 'pro';
  planName: string;
  documentsLimit: number;
  durationDays: number;
}

interface Props {
  onSuccess: (plan: 'basic' | 'pro') => void;
  onClose: () => void;
}

function useCountdown(targetMs: number | null): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!targetMs) return;
    const tick = () => setSeconds(Math.max(0, Math.floor((targetMs - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetMs]);
  return seconds;
}

function fmt(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2 rounded-md border border-white/10 bg-background/60 px-3 py-2">
        <code className="flex-1 truncate text-xs text-foreground">{value}</code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={`Copy ${label}`}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
    </div>
  );
}

export function SubscriptionModal({ onSuccess, onClose }: Props) {
  const t = useTranslations('subscription');
  const tp = useTranslations('pricing');
  const [phase, setPhase] = useState<Phase>('choose');
  const [selectedPlan, setSelectedPlan] = useState<'basic' | 'pro' | null>(null);
  const [details, setDetails] = useState<PaymentDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  // Countdown: 30 min from now when payment details are loaded
  const [expiresMs, setExpiresMs] = useState<number | null>(null);
  const secondsLeft = useCountdown(expiresMs);

  // Plan details — defined inside component so t() is in scope
  const PLAN_DETAILS = {
    basic: {
      name: 'Basic',
      price: '$9.99',
      docs: `10 ${t('docsPerMonth')}`,
      features: [
        tp('allDocTypes'),
        t('aiTranslationShort'),
        tp('cleanPdf'),
        t('daySubscription'),
      ],
      icon: Zap,
      popular: true,
    },
    pro: {
      name: 'Pro',
      price: '$24.99',
      docs: `40 ${t('docsPerMonth')}`,
      features: [
        tp('allDocTypes'),
        t('aiTranslationShort'),
        tp('cleanPdf'),
        tp('priorityProcessing'),
        tp('proBadge'),
      ],
      icon: Star,
      popular: false,
    },
  } as const;

  // Start subscription payment for chosen plan
  async function startSubscription(plan: 'basic' | 'pro'): Promise<void> {
    setSelectedPlan(plan);
    setPhase('loading');
    setError(null);
    try {
      const res = await fetch('/api/subscriptions/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      const data = (await res.json()) as PaymentDetails & { error?: string; detail?: string };
      if (!res.ok) {
        const msg = [data.error, data.detail].filter(Boolean).join(' — ') || 'Failed to create subscription';
        setError(`${msg} (HTTP ${res.status})`);
        setPhase('failed');
        return;
      }
      setDetails(data);
      setExpiresMs(Date.now() + 30 * 60 * 1000);
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setPhase('failed');
    }
  }

  // Poll for activation
  useEffect(() => {
    if (phase !== 'polling' || !details) return;

    const interval = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch('/api/subscriptions/current');
          const data = (await res.json()) as { subscription?: { plan: string; status: string } | null };
          if (data.subscription?.status === 'active') {
            clearInterval(interval);
            setPhase('confirmed');
            setTimeout(() => onSuccess(data.subscription!.plan as 'basic' | 'pro'), 1500);
          } else {
            setPollCount((n) => n + 1);
          }
        } catch {
          // keep polling
        }
      })();
    }, 15_000);

    return () => clearInterval(interval);
  }, [phase, details, onSuccess]);

  function handlePayClick() {
    if (!details) return;
    window.open(details.deeplink, '_blank');
    setPhase('polling');
  }

  async function handleCheckPayment(): Promise<void> {
    if (checking) return;
    setChecking(true);
    setCheckError(null);
    try {
      const res = await fetch('/api/subscriptions/current');
      const data = (await res.json()) as {
        subscription?: { plan: 'basic' | 'pro'; status: string; documentsLimit: number } | null;
      };
      if (data.subscription?.status === 'active') {
        setPhase('confirmed');
        setTimeout(() => onSuccess(data.subscription!.plan), 1500);
      } else {
        setCheckError(t('notConfirmed'));
      }
    } catch {
      setCheckError(t('notConfirmed'));
    } finally {
      setChecking(false);
    }
  }

  const headerTitle =
    phase === 'choose'
      ? t('choosePlan')
      : selectedPlan === 'basic'
      ? t('basicSubscription')
      : t('proSubscription');

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center">
      <div className="relative w-full max-w-lg rounded-xl border border-white/10 bg-card shadow-2xl shadow-black/60">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{headerTitle}</h2>
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
          {/* ── CHOOSE PLAN ── */}
          {phase === 'choose' && (
            <div className="flex flex-col gap-4">
              {(['basic', 'pro'] as const).map((plan) => {
                const p = PLAN_DETAILS[plan];
                const Icon = p.icon;
                return (
                  <div
                    key={plan}
                    className={`relative rounded-lg border p-5 transition-colors ${
                      p.popular
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-white/10 bg-background/40 hover:border-white/20'
                    }`}
                  >
                    {p.popular && (
                      <span className="absolute -top-2.5 left-4 rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
                        {t('mostPopular')}
                      </span>
                    )}
                    <div className="mb-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10">
                          <Icon className="h-4 w-4 text-primary" />
                        </div>
                        <span className="text-sm font-semibold text-foreground">{p.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="text-xl font-extrabold text-foreground">{p.price}</span>
                        <span className="text-xs text-muted-foreground">{t('perMonth')}</span>
                      </div>
                    </div>
                    <p className="mb-3 text-xs font-medium text-primary">{p.docs}</p>
                    <ul className="mb-4 space-y-1">
                      {p.features.map((f) => (
                        <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="text-primary">✓</span>
                          {f}
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      onClick={() => void startSubscription(plan)}
                      className={`inline-flex w-full items-center justify-center rounded-md py-2.5 text-sm font-semibold transition-colors ${
                        p.popular
                          ? 'bg-primary text-primary-foreground hover:bg-gold-dark'
                          : 'border border-white/20 bg-white/5 text-foreground hover:bg-white/10'
                      }`}
                    >
                      {t('subscribeWithTon')}
                    </button>
                  </div>
                );
              })}
              <p className="text-center text-xs text-muted-foreground">{t('tonFootnote')}</p>
            </div>
          )}

          {/* ── LOADING ── */}
          {phase === 'loading' && (
            <div className="flex items-center gap-3 py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">{t('preparing')}</span>
            </div>
          )}

          {/* ── FAILED ── */}
          {phase === 'failed' && (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-destructive">{error ?? t('errorFallback')}</p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setPhase('choose')}
                  className="inline-flex items-center rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white/10"
                >
                  {t('back')}
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center rounded-md border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-white/10"
                >
                  {t('close')}
                </button>
              </div>
            </div>
          )}

          {/* ── CONFIRMED ── */}
          {phase === 'confirmed' && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
                <Check className="h-7 w-7 text-emerald-400" />
              </div>
              <p className="font-semibold text-foreground">{t('activated')}</p>
              <p className="text-sm text-muted-foreground">
                {selectedPlan === 'basic' ? t('basicPlanActive') : t('proPlanActive')}
              </p>
            </div>
          )}

          {/* ── READY / WAITING / POLLING ── */}
          {(phase === 'ready' || phase === 'waiting' || phase === 'polling') && details && (
            <div className="flex flex-col gap-5">
              {/* Amount */}
              <div className="rounded-md border border-white/10 bg-background/60 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-3xl font-bold tracking-tight text-foreground">
                      {details.amountTon}{' '}
                      <span className="text-xl font-medium text-primary">TON</span>
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      ≈ ${details.amountUsd} USD · {details.planName} plan · {details.documentsLimit} docs
                    </p>
                  </div>
                </div>
              </div>

              {/* QR code — desktop */}
              {phase === 'ready' && (
                <div className="hidden flex-col items-center gap-3 md:flex">
                  <div className="rounded-lg border border-white/10 bg-white p-3">
                    <QRCodeSVG value={details.qrData} size={160} />
                  </div>
                  <p className="text-xs text-muted-foreground">{t('scanQr')}</p>
                </div>
              )}

              {/* Polling indicator */}
              {phase === 'polling' && (
                <div className="flex flex-col items-center gap-3 py-2 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                  <p className="text-sm font-medium text-foreground">{t('waitingPayment')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('pollingDesc')}{pollCount > 0 ? ` (${pollCount})` : ''}
                  </p>
                </div>
              )}

              {/* Pay CTA */}
              {phase === 'ready' && (
                <button
                  type="button"
                  onClick={handlePayClick}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
                >
                  {t('openTonkeeper')}
                </button>
              )}

              {/* Manual payment */}
              {(phase === 'ready' || phase === 'polling') && (
                <details className="group rounded-md border border-white/10">
                  <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-medium text-muted-foreground hover:text-foreground">
                    {t('payManually')}
                    <span className="transition-transform duration-200 group-open:rotate-180">▾</span>
                  </summary>
                  <div className="flex flex-col gap-3 border-t border-white/10 px-4 pb-4 pt-3">
                    <CopyField label={t('fieldAddress')} value={details.walletAddress} />
                    <CopyField label={t('fieldAmount')} value={`${details.amountTon} TON`} />
                    <CopyField label={t('fieldMemo')} value={details.subscriptionId} />
                    <p className="text-xs text-muted-foreground">{t('memoNote')}</p>
                  </div>
                </details>
              )}

              {/* I've paid — manual verify */}
              {(phase === 'ready' || phase === 'waiting' || phase === 'polling') && (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCheckPayment()}
                    disabled={checking}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-white/20 bg-transparent py-3 text-sm font-medium text-foreground transition-colors hover:bg-white/5 disabled:pointer-events-none disabled:opacity-50"
                  >
                    {checking ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        {t('checking')}
                      </>
                    ) : (
                      t('ivePaid')
                    )}
                  </button>
                  {checkError && (
                    <p className="text-center text-xs text-amber-400">{checkError}</p>
                  )}
                </div>
              )}

              {/* Timer */}
              {expiresMs && phase !== 'polling' && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t('offerExpires')}</span>
                  <span className={`font-mono font-semibold ${secondsLeft < 120 ? 'text-destructive' : 'text-foreground'}`}>
                    {fmt(secondsLeft)}
                  </span>
                </div>
              )}

              {/* Back */}
              {phase !== 'polling' && (
                <button
                  type="button"
                  onClick={() => { setPhase('choose'); setDetails(null); }}
                  className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                >
                  {t('chooseDifferent')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
