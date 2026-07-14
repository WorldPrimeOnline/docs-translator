/**
 * Generic, feature-agnostic helpers for the `{prefix}/{scope}/{uuid}` raw-upload key
 * convention used by every direct-to-R2 upload flow (order-drafts, documents/upload-card).
 * `scope` may itself contain `/` (e.g. `{userId}/{uploadAttemptId}`) — callers decide what
 * scope means; this module only enforces the shape and blocks path traversal/prefix spoofing.
 */

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function buildRawKey(prefix: string, scope: string): string {
  return `${prefix}/${scope}/${crypto.randomUUID()}`;
}

/**
 * Strictly validates `{prefix}/{scope}/{uuid}` for the exact prefix+scope the caller
 * expects — rejects keys belonging to another scope (draft/user/attempt), arbitrary
 * R2 keys, path traversal, and wrong prefixes. Requiring the remainder after the
 * expected `{prefix}/{scope}/` to be a single canonical-UUID path segment (no `/`
 * anywhere in it) rules out extra path segments and `..` by construction.
 */
export function isValidRawKey(key: string, prefix: string, scope: string): boolean {
  const expectedPrefix = `${prefix}/${scope}/`;
  if (!key.startsWith(expectedPrefix)) return false;
  const rest = key.slice(expectedPrefix.length);
  if (rest.includes('/')) return false;
  return UUID_RE.test(rest);
}
