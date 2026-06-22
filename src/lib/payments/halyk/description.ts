/**
 * Builds a payment description safe for Halyk (max 125 UTF-8 bytes).
 * Does NOT include document names, file paths, or personal document content.
 */
export function buildPaymentDescription(orderId: string): string {
  const raw = `WPO translation order ${orderId}`;
  // Truncate to 125 UTF-8 bytes, not 125 JS characters
  return truncateToUtf8Bytes(raw, 125);
}

function truncateToUtf8Bytes(str: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  if (bytes.length <= maxBytes) return str;

  // Binary-search the safe cut point
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (encoder.encode(str.slice(0, mid)).length <= maxBytes) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return str.slice(0, lo);
}
