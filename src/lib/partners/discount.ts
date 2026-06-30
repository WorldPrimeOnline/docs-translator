/**
 * Pure partner discount calculation — extracted from upload-card for testability.
 *
 * Rules:
 * - No discount if partner is inactive or discount is not configured.
 * - No discount if order amount is below client_discount_min_order_amount.
 * - Percent discount is capped at client_discount_max_amount.
 * - Fixed discount is capped at client_discount_max_amount and at the order amount itself.
 */

export interface PartnerDiscountInput {
  is_active: boolean;
  client_discount_enabled: boolean;
  client_discount_type: string | null;
  client_discount_value: number | null;
  client_discount_min_order_amount: number | null;
  client_discount_max_amount: number | null;
}

/**
 * Calculate the KZT discount to subtract from a base order amount.
 * Returns 0 when no discount applies.
 * Partner referral must still be created even when this returns 0.
 */
export function calculatePartnerDiscount(
  baseAmountKzt: number,
  partner: PartnerDiscountInput | null | undefined,
): number {
  if (
    !partner ||
    !partner.is_active ||
    !partner.client_discount_enabled ||
    !partner.client_discount_type ||
    partner.client_discount_value == null
  ) {
    return 0;
  }

  const minOrder = Number(partner.client_discount_min_order_amount ?? 0);
  if (baseAmountKzt < minOrder) return 0;

  const raw =
    partner.client_discount_type === 'percent'
      ? Math.round((baseAmountKzt * Number(partner.client_discount_value)) / 100)
      : Math.round(Number(partner.client_discount_value));

  const cap =
    partner.client_discount_max_amount != null
      ? Number(partner.client_discount_max_amount)
      : Infinity;

  return Math.min(raw, cap, baseAmountKzt);
}
