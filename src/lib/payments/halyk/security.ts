import { randomBytes, createHash, timingSafeEqual } from 'crypto';

const SECRET_BYTES = 32;

/**
 * Generates a cryptographically secure random secret_hash.
 * Returns base64url encoding (URL-safe, no padding issues).
 * The raw value is passed to Halyk once; the digest is stored.
 */
export function generateSecretHash(): string {
  return randomBytes(SECRET_BYTES).toString('base64url');
}

/**
 * Computes SHA-256 hex digest of a secret_hash value.
 * Store this, never the raw secret.
 */
export function digestSecretHash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Constant-time comparison of an incoming secret against a stored digest.
 * Returns true only if the incoming secret's digest matches the stored digest.
 */
export function verifySecretHash(incomingSecret: string, storedDigest: string): boolean {
  const incoming = digestSecretHash(incomingSecret);
  // Both must be hex strings of identical byte length (64 hex chars = 32 bytes SHA-256)
  try {
    return timingSafeEqual(
      Buffer.from(incoming, 'hex'),
      Buffer.from(storedDigest, 'hex'),
    );
  } catch {
    return false;
  }
}
