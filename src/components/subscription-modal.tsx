'use client';

import { useTranslations } from 'next-intl';

interface Props {
  onSuccess: (plan: 'basic' | 'pro') => void;
  onClose: () => void;
}

export function SubscriptionModal({ onClose }: Props) {
  const t = useTranslations('subscription');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-card px-8 py-10 text-center">
        <p className="mb-6 text-sm text-muted-foreground">
          {t('paymentsComingSoon')}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
        >
          {t('close')}
        </button>
      </div>
    </div>
  );
}
