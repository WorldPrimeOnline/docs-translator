'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface NewModelBreakdown {
  translationAmountKzt: number; ocrAmountKzt: number; notaryAmountKzt: number; courierAmountKzt: number;
  printingAmountKzt: number; coordinationBaseAmountKzt: number; notaryUrgencyMultiplier: number;
  urgencySurchargeKzt: number; coordinationFinalAmountKzt: number; manualAdjustmentKzt: number;
  componentSubtotalKzt: number; grossUpRate: number; grossUpAmountKzt: number; retailBeforeRoundingKzt: number;
  roundingStepKzt: number; roundingAdjustmentKzt: number; retailPriceKzt: number; salesChannel: string;
  clientDiscountKzt: number; actualPaymentKzt: number; partnerCommissionRate: number; channelBudgetKzt: number;
  unusedChannelReserveKzt: number; translatorPayoutKzt: number; notaryPayoutKzt: number; courierPayoutKzt: number;
  printingCostKzt: number; acquiringFeeKzt: number; taxReserveKzt: number; partnerCommissionKzt: number;
  riskReserveKzt: number; marketingReserveKzt: number; aiItReserveKzt: number; ownerReserveKzt: number;
  totalAllocationsKzt: number; netProfitWpoKzt: number; netMargin: number; totalInternalReservesKzt: number;
  totalCashRetainedByWpoKzt: number; reconciliationDifferenceKzt: number; languageRateId: string | null;
  ratePerTranslationPageKzt: number;
}

interface PricingResultLike {
  amountKzt: number;
  status: string;
  requiresOperatorReview: boolean;
  reviewReasons: string[];
  newModel?: NewModelBreakdown;
  context: {
    languagePair: string;
    translationPageCountExact?: number;
    sourceCharacterCountWithSpaces?: number;
    notaryCutoff?: { notaryUrgencyLevel: string; effectiveWindow: string; multiplier: number };
  };
}

function fmt(n: number | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₸';
}
function pct(n: number): string {
  return (n * 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + '%';
}

function Row({ label, value, formula }: { label: string; value: string; formula?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col border-b border-border/50 py-1.5 last:border-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium tabular-nums">{value}</span>
          {formula && (
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="text-xs text-muted-foreground underline decoration-dotted hover:text-foreground"
            >
              {open ? 'Скрыть формулу' : 'Показать формулу'}
            </button>
          )}
        </div>
      </div>
      {formula && open && (
        <div className="mt-1 rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">{formula}</div>
      )}
    </div>
  );
}

export function PricingLabResult({ result }: { result: PricingResultLike }) {
  const nm = result.newModel;

  if (result.requiresOperatorReview) {
    return (
      <Card className="border-amber-500/50">
        <CardHeader><CardTitle className="text-amber-600">Требуется проверка оператора</CardTitle></CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {result.reviewReasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </CardContent>
      </Card>
    );
  }

  if (!nm) {
    return (
      <Card><CardContent className="pt-4 text-sm text-muted-foreground">Нет данных новой формулы (electronic использует старый расчёт).</CardContent></Card>
    );
  }

  const reconciliationOk = Math.abs(nm.reconciliationDifferenceKzt) < 0.01;

  return (
    <div className="flex flex-col gap-3">
      {!reconciliationOk && (
        <Card className="border-destructive bg-destructive/10">
          <CardContent className="pt-4">
            <p className="font-semibold text-destructive">Reconciliation НЕ сходится!</p>
            <p className="text-sm">Разница: {fmt(nm.reconciliationDifferenceKzt)}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>B. Формирование клиентской цены</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Row label="Перевод (T)" value={fmt(nm.translationAmountKzt)}
            formula={`${result.context.sourceCharacterCountWithSpaces ?? '—'} симв. × ${nm.ratePerTranslationPageKzt} ₸ / 1800 (мин. 1 стр.) = ${fmt(nm.translationAmountKzt)}`} />
          <Row label="OCR и техническая обработка (O)" value={fmt(nm.ocrAmountKzt)}
            formula={`физ. страницы × OCR-ставка = ${fmt(nm.ocrAmountKzt)}`} />
          <Row label="Нотариус (N)" value={fmt(nm.notaryAmountKzt)} formula="МРП × коэффициент заявителя" />
          <Row label="Курьер (C)" value={fmt(nm.courierAmountKzt)} />
          <Row label="Печать (P)" value={fmt(nm.printingAmountKzt)} />
          <Row label="Базовая комиссия WPO" value={fmt(nm.coordinationBaseAmountKzt)}
            formula={`30% × (${fmt(nm.translationAmountKzt)} + ${fmt(nm.notaryAmountKzt)} + ${fmt(nm.courierAmountKzt)}) = ${fmt(nm.coordinationBaseAmountKzt)}`} />
          <Row label={`Надбавка за срочность (×${nm.notaryUrgencyMultiplier.toFixed(1)})`} value={fmt(nm.urgencySurchargeKzt)} />
          <Row label="Итоговая комиссия WPO" value={fmt(nm.coordinationFinalAmountKzt)} />
          <Row label="Ручная корректировка (M)" value={fmt(nm.manualAdjustmentKzt)} />
          <Row label="Сумма компонентов" value={fmt(nm.componentSubtotalKzt)} />
          <Row label="Gross-up (общий %)" value={pct(nm.grossUpRate)}
            formula="tax + Halyk + risk + marketing + AI/IT + owner + channel" />
          <Row label="Gross-up (сумма)" value={fmt(nm.grossUpAmountKzt)}
            formula={`subtotal / (1 − ${pct(nm.grossUpRate)}) − subtotal = ${fmt(nm.grossUpAmountKzt)}`} />
          <Row label="Цена до округления" value={fmt(nm.retailBeforeRoundingKzt)} />
          <Row label={`Шаг округления`} value={`${nm.roundingStepKzt} ₸`} />
          <Row label="Retail" value={fmt(nm.retailPriceKzt)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>C. Скидка и партнёрский канал ({nm.salesChannel === 'referral' ? 'Referral' : 'Direct'})</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Row label="Retail" value={fmt(nm.retailPriceKzt)} />
          <Row label="Скидка клиенту" value={fmt(nm.clientDiscountKzt)}
            formula={nm.salesChannel === 'referral' ? `retail × 10% = ${fmt(nm.clientDiscountKzt)}` : undefined} />
          <Row label="Фактическая оплата" value={fmt(nm.actualPaymentKzt)} formula="retail − скидка (без повторного округления)" />
          <Row label="Комиссия партнёру" value={fmt(nm.partnerCommissionKzt)}
            formula={nm.salesChannel === 'referral' ? `actual payment × ${pct(nm.partnerCommissionRate)} = ${fmt(nm.partnerCommissionKzt)}` : undefined} />
          <Row label="Канальный бюджет (20% от retail)" value={fmt(nm.channelBudgetKzt)} />
          <Row label="Остаток канального бюджета" value={fmt(nm.unusedChannelReserveKzt)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>D. Внешние выплаты</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Row label="Переводчику" value={fmt(nm.translatorPayoutKzt)} />
          <Row label="Нотариусу" value={fmt(nm.notaryPayoutKzt)} />
          <Row label="Курьеру" value={fmt(nm.courierPayoutKzt)} />
          <Row label="Печать" value={fmt(nm.printingCostKzt)} />
          <Row label="Halyk" value={fmt(nm.acquiringFeeKzt)} />
          <Row label="Налог" value={fmt(nm.taxReserveKzt)} />
          <Row label="Партнёру" value={fmt(nm.partnerCommissionKzt)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>E. Внутренние резервы</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Row label="Риск" value={fmt(nm.riskReserveKzt)} />
          <Row label="Маркетинг/CAC" value={fmt(nm.marketingReserveKzt)} />
          <Row label="AI/IT" value={fmt(nm.aiItReserveKzt)} />
          <Row label="Владельцы" value={fmt(nm.ownerReserveKzt)} />
          <Row label="Остаток канального резерва" value={fmt(nm.unusedChannelReserveKzt)} />
          <Row label="Всего внутренних резервов" value={fmt(nm.totalInternalReservesKzt)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>F. Результат WPO</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Row label="Фактическая оплата" value={fmt(nm.actualPaymentKzt)} />
          <Row label="Всего внешних выплат + резервов" value={fmt(nm.totalAllocationsKzt)} />
          <Row label="Маржинальная прибыль заказа до постоянных расходов" value={fmt(nm.netProfitWpoKzt)} />
          <Row label="Маржа" value={pct(nm.netMargin)} />
          <Row label="Всего денег остаётся внутри WPO" value={fmt(nm.totalCashRetainedByWpoKzt)} />
          <Row
            label="Reconciliation difference"
            value={fmt(nm.reconciliationDifferenceKzt)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
