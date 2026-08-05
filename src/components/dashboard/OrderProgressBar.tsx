/**
 * 2026-07-24 visual fix: the single gate deciding whether an order shows the plain
 * status line (pre-payment, or otherwise not yet tracking fulfillment progress) or
 * the combined status+percent line with a bar (OrderProgressBar below) — used by
 * src/app/[locale]/dashboard/page.tsx's ActiveOrderCard so the two renders stay
 * mutually exclusive (the status text is never shown twice) without duplicating
 * this condition inline. Pure and unit-tested; never changes resolveCustomerProgressFlow
 * or its percent values, only decides which existing value to render where.
 */
export function shouldShowOrderProgressBar(
  showFulfillmentProgress: boolean,
  progressPercent: number | null,
): boolean {
  return showFulfillmentProgress && progressPercent != null;
}

export interface OrderProgressBarProps {
  statusLabel: string;
  percent: number;
}

/**
 * 2026-07-24 visual simplification: one status+percent line directly above one
 * continuous progress bar. Replaces the previous bar + milestone-dot track + a
 * second, duplicate status line rendered below the dots. Purely presentational —
 * statusLabel and percent are computed upstream (resolveCustomerProgressFlow via
 * getCustomerOrderState) — this component never recomputes or guesses either.
 */
export function OrderProgressBar({ statusLabel, percent }: OrderProgressBarProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-xs text-foreground/70">
        <span className="truncate">{statusLabel}</span>
        <span className="shrink-0 tabular-nums" data-testid="order-progress-percent">{percent}%</span>
      </div>
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10"
        data-testid="order-progress-track"
      >
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${percent}%` }}
          data-testid="order-progress-fill"
        />
      </div>
    </div>
  );
}
