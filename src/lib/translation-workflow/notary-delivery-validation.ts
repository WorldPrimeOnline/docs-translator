/**
 * Upload-form validity for the notary/delivery fields on the order form.
 * Extracted from src/app/[locale]/dashboard/page.tsx so this logic is
 * independently testable — see __tests__/notary-delivery-validation.test.ts.
 *
 * Root cause this fixes: the dashboard's `isFormValid` check compared
 * deliveryPhone/deliveryAddress with `.length > 0` (no trim), so a
 * whitespace-only value could pass as "filled in". deliveryAddress is a
 * free-form textarea — any manually typed street/apartment/comment text is a
 * valid address; there is no structured address object, placeId, or
 * autocomplete-selection requirement.
 */
export interface NotaryDeliveryFormState {
  isNotarization: boolean;
  notaryCity: string;
  fulfillmentMethod: string;
  deliveryPhone: string;
  deliveryAddress: string;
}

/** Delivery is only required once the customer has actually chosen "delivery" as the fulfillment method. */
export function isDeliverySelected(state: Pick<NotaryDeliveryFormState, 'isNotarization' | 'fulfillmentMethod'>): boolean {
  return state.isNotarization && state.fulfillmentMethod === 'delivery';
}

/** Free-form text is a valid address — trimmed non-empty is the only requirement. */
export function isFilledIn(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * True when the notary/delivery portion of the upload form is complete enough
 * to allow submission. Non-notarized orders always pass (this check is a
 * no-op for them). Pickup orders never require phone/address. Delivery orders
 * require city + fulfillment method + a non-whitespace phone and address.
 */
export function isNotaryDeliveryValid(state: NotaryDeliveryFormState): boolean {
  if (!state.isNotarization) return true;
  if (!isFilledIn(state.notaryCity)) return false;
  if (state.fulfillmentMethod === '') return false;
  if (!isDeliverySelected(state)) return true;
  return isFilledIn(state.deliveryPhone) && isFilledIn(state.deliveryAddress);
}
