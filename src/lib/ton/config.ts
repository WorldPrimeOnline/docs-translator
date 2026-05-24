export const MERCHANT_ADDRESS = 'UQDIvueE6lkIqdO2qU_cn-Ue2fPcEF3N_6SjAt437ZTrlnLG';

export const PAYMENT_WINDOW_MS = 30 * 60 * 1000;

// passport/driver_license are typically 1-2 pages — flat rate
// everything else charges the standard rate
export function getPriceUsd(documentType: string): number {
  if (documentType === 'passport' || documentType === 'driver_license') return 3.99;
  return 4.99;
}
