/**
 * Notary urgency snapshot resolution — pure functions, no DB/Jira access.
 *
 * jobs.notary_urgency_* (migration 0048) is the canonical source — an immutable
 * copy of the pricing result made at quote time (src/lib/pricing/service.ts,
 * extractNotaryUrgencySnapshot()). For jobs created before that migration
 * existed, fall back to price_quotes.pricing_context_json.notaryCutoff (also an
 * immutable, quote-time snapshot — never re-derive via getNotaryCutoffWindow(),
 * which would use the CURRENT time instead of the time the order was actually
 * quoted, silently changing historical pricing context).
 *
 * Extracted into its own module (rather than living in integrations.ts, which
 * imports from ./jira/price-breakdown) so both integrations.ts and
 * jira/price-breakdown.ts can use it without a circular import.
 */

export interface ResolvedNotaryUrgencySnapshot {
  level: 'standard' | 'same_day';
  window: string;
  multiplier: number;
  cutoffAt: string | null;
  feeKzt: number;
}

export interface JobUrgencyColumns {
  notary_urgency_level?: string | null;
  notary_urgency_window?: string | null;
  notary_urgency_multiplier?: number | string | null;
  notary_urgency_cutoff_at?: string | null;
  notary_urgency_fee_kzt?: number | string | null;
}

export interface QuoteUrgencyJson {
  pricingContextJson?: Record<string, unknown>;
  breakdownJson?: Record<string, unknown>;
}

export function resolveNotaryUrgencySnapshot(
  job: JobUrgencyColumns | null | undefined,
  quote?: QuoteUrgencyJson | null,
): ResolvedNotaryUrgencySnapshot | null {
  if (job?.notary_urgency_level != null) {
    return {
      level: job.notary_urgency_level as 'standard' | 'same_day',
      window: job.notary_urgency_window ?? 'standard',
      multiplier: Number(job.notary_urgency_multiplier ?? 1),
      cutoffAt: job.notary_urgency_cutoff_at ?? null,
      feeKzt: Number(job.notary_urgency_fee_kzt ?? 0),
    };
  }

  const cutoff = quote?.pricingContextJson?.notaryCutoff as Record<string, unknown> | undefined;
  if (!cutoff) return null;

  const items = (quote?.breakdownJson?.items as Array<Record<string, unknown>> | undefined) ?? [];
  const feeItem = items.find((item) => item.itemType === 'notary_urgency_fee');

  return {
    level: cutoff.notaryUrgencyLevel as 'standard' | 'same_day',
    window: (cutoff.effectiveWindow as string | undefined) ?? 'standard',
    multiplier: Number(cutoff.multiplier ?? 1),
    cutoffAt: (cutoff.cutoffAt as string | null | undefined) ?? null,
    feeKzt: Number((feeItem?.amountKzt as number | string | undefined) ?? 0),
  };
}
