'use client';

import React, { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { FlaskConical, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

// Staging-only — `NEXT_PUBLIC_APP_ENV` is baked in at build time per environment
// (see .env.staging.example / .env.example), so a production build never ships this
// component's dialog contents past dead-code elimination. Mirrors the
// PAYMENTS_ENABLED gate pattern in HalykPayButton.tsx.
const BYPASS_UI_ENABLED = process.env.NEXT_PUBLIC_APP_ENV === 'staging';

interface Props {
  jobId: string;
  quoteId: string;
  className?: string;
  /** Called after a successful bypass, before navigating to the payment result page. */
  onSuccess?: (paymentId: string) => void;
}

type Status = 'idle' | 'submitting' | 'error';

/**
 * Split out from the exported wrapper so useRouter() is only ever called when the
 * gate is on — when BYPASS_UI_ENABLED is false this whole subtree (and its hooks)
 * simply never renders, rather than the hook running and then early-returning null.
 */
function StagingPaymentBypassButtonImpl({ jobId, quoteId, className = '', onSuccess }: Props): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('payment.stagingBypass');
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === 'submitting') return;
    setStatus('submitting');

    try {
      const res = await fetch('/api/payments/staging-bypass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, quoteId, password }),
        credentials: 'same-origin',
      });

      if (!res.ok) {
        setPassword('');
        setStatus('error');
        return;
      }

      const data = await res.json() as { paymentId: string };
      setOpen(false);
      setStatus('idle');
      setPassword('');
      onSuccess?.(data.paymentId);
      router.push(`/payment/result?payment=${encodeURIComponent(data.paymentId)}`);
    } catch {
      setPassword('');
      setStatus('error');
    }
  }, [jobId, quoteId, password, status, onSuccess, router]);

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => { setStatus('idle'); setPassword(''); setOpen(true); }}
        className="w-full gap-2 border-dashed border-amber-500/50 text-amber-500 hover:bg-amber-500/10 hover:text-amber-400"
      >
        <FlaskConical className="h-3.5 w-3.5" />
        {t('buttonLabel')}
      </Button>

      <Dialog open={open} onOpenChange={(next) => { if (status !== 'submitting') setOpen(next); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dialogTitle')}</DialogTitle>
            <DialogDescription>{t('dialogDescription')}</DialogDescription>
          </DialogHeader>

          <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="staging-bypass-password">{t('passwordLabel')}</Label>
              <Input
                id="staging-bypass-password"
                type="password"
                autoComplete="off"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={status === 'submitting'}
              />
              {status === 'error' && (
                <p className="text-sm text-red-400">{t('invalidPassword')}</p>
              )}
            </div>

            <DialogFooter>
              <Button type="submit" disabled={status === 'submitting' || !password}>
                {status === 'submitting' ? <Loader2 className="h-4 w-4 animate-spin" /> : t('confirmButton')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function StagingPaymentBypassButton(props: Props): React.ReactElement | null {
  if (!BYPASS_UI_ENABLED) return null;
  return <StagingPaymentBypassButtonImpl {...props} />;
}
