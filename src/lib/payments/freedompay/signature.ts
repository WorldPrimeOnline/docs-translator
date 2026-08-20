/**
 * Freedom Pay pg_sig signature — single reusable module, used identically by
 * payment initiation, status checks, refunds (outbound requests) and by the Result
 * URL callback handler (inbound verification + outbound ACK signing).
 *
 * Algorithm (docs.freedompay.kz Merchant API, source of truth per 2026-08-20 scope
 * correction — see the Freedom Pay integration DELTA REPORT):
 *
 *   signature_string = script_name + ";" + <all message fields incl. pg_salt,
 *     sorted alphabetically by key, VALUES ONLY> + ";" + secret_key
 *   pg_sig = md5(signature_string)   // lowercase 32-char hex
 *
 * `fields` passed to buildSignature/verifySignature must NOT include pg_sig itself.
 *
 * script_name for OUTBOUND requests WPO sends is the literal endpoint basename being
 * called (FREEDOMPAY_SCRIPT_NAMES below — confirmed against docs.freedompay.kz).
 *
 * script_name for the INBOUND Result URL (verifying Freedom Pay's callback signature,
 * and signing WPO's own ACK response to it) is NOT documented anywhere findable —
 * confirmed after a deep, cited documentation pass. The convention used here (basename
 * of WPO's own configured pg_result_url, e.g. "result") is the user's explicit design
 * decision, not a vendor-confirmed fact. deriveScriptNameFromUrl() exists specifically
 * so this one assumption can be corrected in a single place if the first real staging
 * callback disproves it — see BLOCKER FOR REAL E2E in the DELTA REPORT.
 */
import { createHash, timingSafeEqual } from 'crypto';

export const FREEDOMPAY_SCRIPT_NAMES = {
  createPayment: 'init_payment',
  status: 'get_status3.php',
  refund: 'revoke',
} as const;

/**
 * Derives a signature script_name from a callback URL's path basename — e.g.
 * "https://staging.example.com/api/payments/freedompay/result" -> "result", or a bare
 * path "/api/payments/freedompay/result" -> "result". Single point of adjustment for
 * the unconfirmed inbound-signature script_name convention (see module doc comment).
 */
export function deriveScriptNameFromUrl(urlOrPath: string): string {
  let pathname = urlOrPath;
  try {
    pathname = new URL(urlOrPath).pathname;
  } catch {
    // Not a full URL — treat the input as already a path.
  }
  const segments = pathname.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? '';
}

function buildSignatureString(scriptName: string, fields: Record<string, string>, secretKey: string): string {
  const sortedValues = Object.keys(fields)
    .sort()
    .map((key) => fields[key]);
  return [scriptName, ...sortedValues, secretKey].join(';');
}

/** Computes pg_sig for a set of fields. `fields` must exclude pg_sig itself. */
export function buildSignature(scriptName: string, fields: Record<string, string>, secretKey: string): string {
  const signatureString = buildSignatureString(scriptName, fields, secretKey);
  return createHash('md5').update(signatureString, 'utf8').digest('hex');
}

/**
 * Constant-time verification of an inbound pg_sig. `fields` must be exactly the
 * fields Freedom Pay sent (excluding pg_sig itself) — per the docs, any extra
 * non-pg_-prefixed param WPO ever echoes back also participates in the signature, so
 * callers must sign over exactly what was received, not a hardcoded fixed set.
 */
export function verifySignature(
  scriptName: string,
  fields: Record<string, string>,
  secretKey: string,
  providedSig: string,
): boolean {
  const expectedHex = buildSignature(scriptName, fields, secretKey);
  try {
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const providedBuf = Buffer.from(providedSig.trim().toLowerCase(), 'hex');
    if (expectedBuf.length !== providedBuf.length) return false;
    return timingSafeEqual(expectedBuf, providedBuf);
  } catch {
    return false;
  }
}
