export type VerificationItemType =
  | 'contact_url'
  | 'verification_url'
  | 'document_number'
  | 'qr_payload'
  | 'email'
  | 'phone'
  | 'mrz'
  | 'verification_code'
  | 'iban'
  | 'swift_bic'
  | 'barcode_value'
  | 'unknown';

/**
 * Classify a verification item value using structural patterns only (language-independent).
 * Never uses localized keywords — only regex patterns over the value's character structure.
 */
export function classifyVerificationItem(value: string): VerificationItemType {
  const trimmed = value.trim();
  if (!trimmed) return 'unknown';

  // MRZ: two or more lines of [A-Z0-9<] with length >= 30 each
  const lines = trimmed.split(/\r?\n/);
  const mrzLines = lines.filter((l) => /^[A-Z0-9<]{30,}$/.test(l));
  if (mrzLines.length >= 2) return 'mrz';

  // Single MRZ line
  if (/^[A-Z0-9<]{30,}$/.test(trimmed)) return 'mrz';

  // Email — must have @, no spaces
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) return 'email';

  // URL with verification path keywords
  if (/^https?:\/\//i.test(trimmed)) {
    if (/\/(verify|check|auth|confirm)/i.test(trimmed)) return 'verification_url';
    return 'contact_url';
  }

  // Phone: E.164 or common formatted patterns (must have 7+ digit sequence)
  if (
    /^\+?[\d\s\-().]{7,20}$/.test(trimmed) &&
    trimmed.replace(/\D/g, '').length >= 7
  ) {
    return 'phone';
  }

  // IBAN: CC + 2 digits + 4–30 alphanumeric chars, minimum 15 chars (shortest real IBAN)
  if (trimmed.length >= 15 && /^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/.test(trimmed)) return 'iban';

  // SWIFT/BIC: 8 or 11 characters in format AAAABBCC[XXX]
  if (/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(trimmed)) return 'swift_bic';

  // QR payload: long opaque string without spaces (>40 chars)
  if (trimmed.length > 40 && !/\s/.test(trimmed)) return 'qr_payload';

  // Document number: letter prefix + digit suffix (e.g. AB123456, KZ12345)
  if (/^[A-Z]{1,4}\d{5,12}$/.test(trimmed)) return 'document_number';
  // Or digit prefix + letter suffix
  if (/^\d{5,12}[A-Z]{1,4}$/.test(trimmed)) return 'document_number';

  // Short verification code: 4–20 uppercase alphanumeric chars
  if (/^[A-Z0-9]{4,20}$/.test(trimmed)) return 'verification_code';

  return 'unknown';
}
