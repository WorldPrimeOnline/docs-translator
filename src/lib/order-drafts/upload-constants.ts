/**
 * Single source of truth for order-draft upload limits and R2 key conventions.
 * Isomorphic — no server-only imports — safe to import from both the client
 * component (OrderForm.tsx) and server route handlers/services, so frontend and
 * backend can never drift on what the limits actually are.
 */

export const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

export const MAX_FILE_SIZE_EACH = 20 * 1024 * 1024;
export const ANONYMOUS_MAX_TOTAL_SIZE = 20 * 1024 * 1024;
export const AUTHENTICATED_MAX_TOTAL_SIZE = 50 * 1024 * 1024;

/** Max files per draft upload batch — arbitrary but generous; not currently enforced by the UI. */
export const MAX_UPLOAD_FILE_COUNT = 10;

/** Presigned PUT URL lifetime for direct browser -> R2 uploads. */
export const UPLOAD_URL_TTL_SECONDS = 600;

/** Prefix for temporary, not-yet-converted raw uploads — cleaned up by cron if never completed. */
export const RAW_UPLOAD_PREFIX = 'draft-upload-raw';

/** Prefix for the final, merged-PDF draft file — same prefix the legacy endpoint has always used. */
export const DRAFT_UPLOADS_PREFIX = 'draft-uploads';
