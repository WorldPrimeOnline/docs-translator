/**
 * Server-only shared logic for order-draft file uploads. Used by the init/complete
 * direct-to-R2 endpoints AND the legacy single-request upload endpoint, so ownership
 * checks, MIME resolution, and R2 key conventions can never drift between them.
 *
 * Transitively server-only: pulls in next/headers via getDraftSessionToken/
 * getOptionalAuthUser, which throws if bundled into a client component — same
 * enforcement mechanism already relied on by service.ts/request-context.ts.
 */
import { getDraftRow, isOwner } from './service';
import { getDraftSessionToken } from './session';
import { getOptionalAuthUser } from './request-context';
import { ALLOWED_MIME_TYPES, RAW_UPLOAD_PREFIX, DRAFT_UPLOADS_PREFIX } from './upload-constants';
import { buildRawKey, isValidRawKey } from '@/lib/r2/upload-key-utils';
import type { OrderDraftRow } from './types';

export interface DraftUploadOwner {
  sessionToken: string | null;
  userId: string | null;
}

export async function resolveDraftUploadOwner(): Promise<DraftUploadOwner> {
  const [sessionToken, user] = await Promise.all([getDraftSessionToken(), getOptionalAuthUser()]);
  return { sessionToken, userId: user?.id ?? null };
}

export type LoadOwnedDraftResult =
  | { ok: true; draft: OrderDraftRow; owner: DraftUploadOwner }
  | { ok: false; error: 'DRAFT_NOT_FOUND' | 'FORBIDDEN' };

/** Shared draft-lookup + ownership check used by init, complete, and the legacy endpoint. */
export async function loadOwnedDraft(draftId: string): Promise<LoadOwnedDraftResult> {
  const draft = await getDraftRow(draftId);
  if (!draft) return { ok: false, error: 'DRAFT_NOT_FOUND' };

  const owner = await resolveDraftUploadOwner();
  if (!isOwner(draft, owner)) return { ok: false, error: 'FORBIDDEN' };

  return { ok: true, draft, owner };
}

/**
 * Resolves the effective MIME type for a file from its claimed Content-Type plus an
 * extension fallback — same rule the legacy endpoint has always used, just generalized
 * to take plain strings (originalName/claimedMimeType) instead of a browser File object,
 * since init/complete only ever see JSON metadata, never the File itself.
 */
export function resolveMimeType(originalName: string, claimedMimeType: string | null | undefined): string {
  if (claimedMimeType && Object.prototype.hasOwnProperty.call(ALLOWED_MIME_TYPES, claimedMimeType)) {
    return claimedMimeType;
  }
  const ext = originalName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return claimedMimeType ?? '';
}

export function isAllowedMimeType(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_MIME_TYPES, mimeType);
}

/** Same sanitization the legacy endpoint has always applied before storing a filename. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 200);
}

/** Same "N_files_firstname" combination rule the legacy endpoint has always used for multi-file drafts. */
export function buildCombinedOriginalName(originalNames: string[]): string {
  const first = sanitizeFilename(originalNames[0] ?? 'document');
  return originalNames.length === 1 ? first : `${originalNames.length}_files_${first}`;
}

/** Server-generated only — never accept a raw upload key from the client on init. */
export function buildRawUploadKey(draftId: string): string {
  return buildRawKey(RAW_UPLOAD_PREFIX, draftId);
}

/** The permanent, single-object key a draft's merged PDF has always lived at. */
export function finalUploadKey(draftId: string): string {
  return `${DRAFT_UPLOADS_PREFIX}/${draftId}/original.pdf`;
}

/**
 * Strictly validates `draft-upload-raw/{draftId}/{uuid}` — rejects keys belonging to
 * another draft, the final key, arbitrary/attacker-supplied keys, path traversal, and
 * wrong prefixes. Delegates to the generic {prefix}/{scope}/{uuid} validator in
 * src/lib/r2/upload-key-utils.ts (also used by documents/upload-card's direct-to-R2 flow).
 */
export function isValidRawUploadKey(key: string, draftId: string): boolean {
  return isValidRawKey(key, RAW_UPLOAD_PREFIX, draftId);
}
