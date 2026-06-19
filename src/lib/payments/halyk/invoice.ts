import { randomBytes } from 'crypto';

const MAX_GENERATION_ATTEMPTS = 10;

/**
 * Generates a cryptographically secure 15-digit numeric invoice ID.
 * Requirements from Halyk:
 *   - digits only
 *   - length 6–15
 *   - globally unique
 *   - last 6 digits must also be unique
 */
export function generateInvoiceId(): string {
  // Generate 8 random bytes → read as uint64 → map to 15-digit range
  const bytes = randomBytes(8);
  const bigint = bytes.readBigUInt64BE(0);

  // Produce a 15-digit number: range [100_000_000_000_000, 999_999_999_999_999]
  // Use BigInt() constructor to avoid n-suffix literals (requires ES2020 target)
  const min = BigInt('100000000000000');
  const max = BigInt('999999999999999');
  const range = max - min + BigInt(1);
  const value = (bigint % range) + min;

  return value.toString();
}

/**
 * Returns the last 6 digits of an invoice ID.
 * Halyk requires these to be unique across all invoices.
 */
export function getInvoiceSuffix6(invoiceId: string): string {
  return invoiceId.slice(-6);
}

/**
 * Validates that an invoice ID meets Halyk requirements:
 * - digits only
 * - length 6–15
 */
export function validateInvoiceId(invoiceId: string): boolean {
  return /^\d{6,15}$/.test(invoiceId);
}

/**
 * Generates a unique invoice ID with collision retry.
 * The caller provides an async check function that returns true if the ID is free.
 */
export async function generateUniqueInvoiceId(
  isFree: (id: string, suffix6: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const id = generateInvoiceId();
    const suffix6 = getInvoiceSuffix6(id);
    if (await isFree(id, suffix6)) {
      return id;
    }
  }
  throw new Error(`Failed to generate unique invoice ID after ${MAX_GENERATION_ATTEMPTS} attempts`);
}
