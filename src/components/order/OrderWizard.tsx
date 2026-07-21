'use client';

import { useState } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { OrderForm, type DraftPriceResult } from '@/components/order/OrderForm';

/**
 * Thin public-only wrapper around the shared OrderForm (src/components/order/OrderForm.tsx —
 * the same component the dashboard renders in mode="dashboard"). This wrapper owns only the
 * one screen with no dashboard equivalent: showing the calculated price and gating payment
 * behind login. The form itself — fields, copy, classes, service level cards, notary block,
 * consent, promo code, price hint, and the "Загрузить документ" button — is identical to
 * the dashboard, by construction, since both render the same OrderForm component.
 */
export function OrderWizard() {
  const locale = useLocale();
  const router = useRouter();
  const t = useTranslations('startWizard');

  const [draftId, setDraftId] = useState<string | null>(null);
  const [price, setPrice] = useState<DraftPriceResult | null>(null);

  const handlePay = async (): Promise<void> => {
    if (!draftId) return;
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const checkoutPath = `/${locale}/checkout?draftId=${draftId}`;

    if (!data.session) {
      router.push(`/${locale}/auth/login?next=${encodeURIComponent(checkoutPath)}`);
      return;
    }
    router.push(checkoutPath);
  };

  if (price && draftId) {
    return (
      <div className="rounded-lg border border-white/10 bg-card p-6">
        <h2 className="mb-1 text-lg font-semibold text-foreground">{t('priceReadyTitle')}</h2>
        <p className="mb-5 text-sm text-muted-foreground">{t('signInHint')}</p>

        <div className="mb-5 rounded-lg border border-primary/30 bg-primary/5 p-5 text-center">
          {price.discountAppliedKzt && price.discountAppliedKzt > 0 && price.priceBeforeDiscountKzt ? (
            <div className="mb-1 text-sm text-muted-foreground line-through">
              {price.priceBeforeDiscountKzt.toLocaleString()} {price.currency}
            </div>
          ) : null}
          <div className="text-3xl font-extrabold text-foreground">
            {price.priceKzt.toLocaleString()} {price.currency}
          </div>
          {price.discountAppliedKzt && price.discountAppliedKzt > 0 && price.discountCode ? (
            <div className="mt-1 text-xs font-medium text-emerald-400">
              {t('discountApplied', { amount: price.discountAppliedKzt.toLocaleString(), code: price.discountCode })}
            </div>
          ) : null}
        </div>

        {/* 2026-07-22: requiresOperatorReview is never true here anymore — calculateDraftPrice()
            treats it as a terminal UNSUPPORTED_DOCUMENT failure before a draft is ever priced
            (WPO has no manual operator pricing process), so reaching this screen always means a
            real, automatically-computed price exists. */}

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setPrice(null)}
            className="inline-flex flex-1 items-center justify-center rounded-md border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-foreground/80 transition-colors hover:border-white/20 hover:text-foreground"
          >
            {t('editDetails')}
          </button>
          <button
            type="button"
            onClick={() => void handlePay()}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-gold-dark"
          >
            {t('continueToPayment')}
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <OrderForm
      mode="publicStart"
      draftId={draftId}
      onDraftIdChange={setDraftId}
      onDraftPriced={(result) => setPrice(result)}
    />
  );
}
