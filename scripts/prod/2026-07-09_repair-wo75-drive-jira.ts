#!/usr/bin/env npx tsx
/**
 * One-time Drive/Jira repair for WO-75 (and reusable for any other paid/converted
 * job with the same gap) — 2026-07-09 incident.
 *
 * Root cause: worker/src/lib/integrations.ts initializeOrderIntegrations() creates
 * the Drive folder and the Jira issue in a single pass, before OCR. When Drive
 * folder creation fails (WO-75: Google OAuth token refresh returned 400 —
 * invalid/expired/revoked refresh token or a mismatched client_id/client_secret
 * pair), the Jira issue is still created immediately afterward, permanently
 * missing the documentsLink field. Nothing else ever retries Drive or goes back
 * to patch the already-created Jira issue. See worker/src/lib/integrations-repair.ts
 * for the reusable, idempotent version of this logic (used by the worker itself
 * going forward); this script is the one-off CLI wrapper for manual incident repair.
 *
 * SAFETY:
 *   - Default mode is DRY RUN — prints every action it would take, writes nothing.
 *   - Requires --apply AND the env var CONFIRM_PRODUCTION_WRITE=true to write anything.
 *   - Never overwrites a Jira field that already has a value (delegates to the
 *     same skip-if-already-set check as the worker's backfillJiraOrderFields).
 *   - Drive folder/subfolder creation is find-or-create — safe to rerun.
 *   - Does not touch payment_transactions, price_quotes, or any pricing/payment logic.
 *
 * Usage:
 *   npx tsx scripts/prod/2026-07-09_repair-wo75-drive-jira.ts --job-id <uuid>
 *   npx tsx scripts/prod/2026-07-09_repair-wo75-drive-jira.ts --job-id <uuid> --apply
 *
 * Required env vars (load via shell env or an untracked .env file you point --env-file at):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (production service role key — never commit this)
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *   GOOGLE_AUTH_MODE (service_account|oauth), + matching Drive credentials
 *   GOOGLE_DRIVE_ROOT_FOLDER_ID
 *   JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
 *
 * Do NOT run --apply until the --dry-run output has been reviewed and approved.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

// ─── CLI args ─────────────────────────────────────────────────────────────────

const WO75_JOB_ID_DEFAULT = '16a6e84d-6d3d-4728-9938-83ca93970001';

function parseArgs(): { jobId: string; apply: boolean; envFile: string | null } {
  const args = process.argv.slice(2);
  let jobId = WO75_JOB_ID_DEFAULT;
  let apply = false;
  let envFile: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--job-id' && args[i + 1]) jobId = args[++i]!;
    if (args[i] === '--apply') apply = true;
    if (args[i] === '--env-file' && args[i + 1]) envFile = args[++i]!;
  }
  return { jobId, apply, envFile };
}

const { jobId: JOB_ID, apply: APPLY, envFile: ENV_FILE } = parseArgs();

// ─── Env loading ──────────────────────────────────────────────────────────────

if (ENV_FILE && fs.existsSync(path.resolve(ENV_FILE))) {
  dotenv.config({ path: path.resolve(ENV_FILE) });
  console.log(`[repair-wo75] loaded env from ${ENV_FILE}`);
} else {
  console.log('[repair-wo75] no --env-file given — relying on shell environment only');
}

if (APPLY && process.env.CONFIRM_PRODUCTION_WRITE !== 'true') {
  console.error(
    '[repair-wo75] REFUSED: --apply requires CONFIRM_PRODUCTION_WRITE=true to be set explicitly. ' +
    'Run without --apply first and review the dry-run output.',
  );
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[repair-wo75] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(SUPABASE_URL, SERVICE_KEY) as any;

// ─── R2 client (mirrors worker/src/lib/r2.ts) ────────────────────────────────

function getR2Client(): S3Client | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function downloadFromR2(key: string): Promise<Buffer> {
  const bucket = process.env.R2_BUCKET_NAME;
  const s3 = getR2Client();
  if (!s3 || !bucket) throw new Error('R2 not configured');
  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!res.Body) throw new Error(`Empty R2 body for key: ${key}`);
  const bytes = await res.Body.transformToByteArray();
  return Buffer.from(bytes);
}

// ─── Google Drive (mirrors worker/src/lib/google-drive.ts, trimmed) ──────────

function getAuthMode(): 'service_account' | 'oauth' {
  return process.env.GOOGLE_AUTH_MODE === 'service_account' ? 'service_account' : 'oauth';
}

function isDriveConfigured(): boolean {
  const mode = getAuthMode();
  const hasRoot = !!process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (mode === 'service_account') {
    return hasRoot && !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  }
  return hasRoot && !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET && !!process.env.GOOGLE_REFRESH_TOKEN;
}

function extractGoogleTokenError(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: string; error_description?: string };
    if (parsed.error) return `${parsed.error}${parsed.error_description ? ` — ${parsed.error_description}` : ''}`;
  } catch { /* not JSON */ }
  return text.slice(0, 200);
}

async function fetchServiceAccountToken(): Promise<string> {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64!;
  const sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8')) as { client_email: string; private_key: string; token_uri?: string };
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  const signature = sign.sign(sa.private_key).toString('base64url');
  const jwt = `${unsigned}.${signature}`;

  const res = await fetch(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Service account token fetch failed: ${res.status} — ${extractGoogleTokenError(await res.text())}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function fetchOAuthToken(): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN!;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
  });
  if (!res.ok) {
    const reason = extractGoogleTokenError(await res.text());
    throw new Error(`Google OAuth token refresh failed: ${res.status} — ${reason}`);
  }
  return ((await res.json()) as { access_token: string }).access_token;
}

async function getDriveToken(): Promise<string> {
  return getAuthMode() === 'service_account' ? fetchServiceAccountToken() : fetchOAuthToken();
}

async function findExistingFolder(token: string, name: string, parentId: string): Promise<string | null> {
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { files: { id: string }[] };
  return data.files[0]?.id ?? null;
}

async function createFolder(token: string, name: string, parentId: string): Promise<string> {
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  if (!res.ok) throw new Error(`Drive createFolder "${name}" failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { id: string }).id;
}

async function getOrCreateFolder(token: string, name: string, parentId: string): Promise<string> {
  const existing = await findExistingFolder(token, name, parentId);
  if (existing) return existing;
  return createFolder(token, name, parentId);
}

async function uploadFileToDrive(token: string, folderId: string, filename: string, buffer: Buffer, mimeType: string): Promise<void> {
  const boundary = `wpo_boundary_${Date.now()}`;
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`, 'utf-8'),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, 'utf-8'),
    buffer,
    Buffer.from(`\r\n--${boundary}--`, 'utf-8'),
  ]);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive upload "${filename}" failed: ${res.status} ${await res.text()}`);
}

const DRIVE_SUBFOLDERS = ['01_SOURCE', '02_AI_DRAFT', '03_TRANSLATOR_RESULT', '04_SIGNATURE_AND_STAMP', '05_NOTARY', '06_FINAL'];

// ─── Jira (mirrors worker/src/lib/jira/order-fields.ts field IDs) ────────────

const JIRA_FIELDS = {
  deliveryAddress: 'customfield_10076',
  deliveryPhone: 'customfield_10075',
  documentsLink: 'customfield_10079',
} as const;

function getJiraAuth(): { baseUrl: string; authHeader: string } | null {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !token) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ''), authHeader: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64') };
}

async function getExistingJiraFields(issueKey: string): Promise<Record<string, unknown> | null> {
  const auth = getJiraAuth();
  if (!auth) return null;
  const fieldIds = Object.values(JIRA_FIELDS).join(',');
  const res = await fetch(`${auth.baseUrl}/rest/api/3/issue/${issueKey}?fields=${fieldIds}`, {
    headers: { Authorization: auth.authHeader, Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { fields: Record<string, unknown> };
  return data.fields;
}

async function patchJiraFields(issueKey: string, fields: Record<string, unknown>): Promise<void> {
  const auth = getJiraAuth();
  if (!auth) throw new Error('Jira not configured');
  const res = await fetch(`${auth.baseUrl}/rest/api/3/issue/${issueKey}`, {
    method: 'PUT',
    headers: { Authorization: auth.authHeader, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Jira update failed: ${res.status} ${await res.text()}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n[repair-wo75] job=${JOB_ID} mode=${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const { data: job, error: jobErr } = await db
    .from('jobs')
    .select('id, document_id, jira_issue_key, google_drive_folder_id, google_drive_folder_url, fulfillment_method, delivery_phone, delivery_address')
    .eq('id', JOB_ID)
    .maybeSingle();

  if (jobErr || !job) {
    console.error('[repair-wo75] job not found:', jobErr?.message ?? JOB_ID);
    process.exit(1);
  }

  const { data: doc } = await db.from('documents').select('id, file_key').eq('id', job.document_id).maybeSingle();
  if (!doc) {
    console.error('[repair-wo75] document not found for job:', job.document_id);
    process.exit(1);
  }

  const { data: translation } = await db
    .from('translations')
    .select('translated_docx_key, translated_preview_pdf_key')
    .eq('job_id', JOB_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  console.log('[repair-wo75] current DB state:', {
    jiraIssueKey: job.jira_issue_key,
    driveFolderId: job.google_drive_folder_id,
    driveUrl: job.google_drive_folder_url,
    fulfillmentMethod: job.fulfillment_method,
    hasDeliveryPhone: !!job.delivery_phone,
    hasDeliveryAddress: !!job.delivery_address,
    hasTranslatorDraft: !!translation?.translated_docx_key,
    hasPreviewPdf: !!translation?.translated_preview_pdf_key,
  });

  let driveFolderId: string | null = job.google_drive_folder_id;
  let driveUrl: string | null = job.google_drive_folder_url;

  // ── Drive folder ────────────────────────────────────────────────────────────
  if (driveFolderId) {
    console.log(`[repair-wo75] Drive folder already exists: ${driveUrl}`);
  } else if (!isDriveConfigured()) {
    console.error('[repair-wo75] Google Drive not configured in this shell — cannot create folder. Set GOOGLE_* env vars.');
  } else if (!APPLY) {
    console.log(`[repair-wo75] [dry-run] would create Drive folder "WPO-${JOB_ID.slice(0, 8)}" + 6 subfolders, then upload original + translator_draft.docx${translation?.translated_preview_pdf_key ? ' + preview.pdf' : ''}`);
  } else {
    const token = await getDriveToken();
    const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;
    const folderName = `WPO-${JOB_ID.slice(0, 8)}`;
    driveFolderId = await getOrCreateFolder(token, folderName, rootFolderId);
    const subfolderIds = await Promise.all(DRIVE_SUBFOLDERS.map((name) => getOrCreateFolder(token, name, driveFolderId!)));
    driveUrl = `https://drive.google.com/drive/folders/${driveFolderId}`;
    console.log(`[repair-wo75] ✓ Drive folder created: ${driveUrl}`);

    await db.from('jobs').update({
      google_drive_folder_id: driveFolderId,
      google_drive_folder_url: driveUrl,
      drive_sync_status: 'created',
      last_synced_at: new Date().toISOString(),
    }).eq('id', JOB_ID);

    const sourceFolderId = subfolderIds[0]!;
    const aiDraftFolderId = subfolderIds[1]!;

    const originalBuf = await downloadFromR2(doc.file_key);
    await uploadFileToDrive(token, sourceFolderId, 'source.pdf', originalBuf, 'application/pdf');
    console.log('[repair-wo75] ✓ uploaded source.pdf');

    if (translation?.translated_docx_key) {
      const draftBuf = await downloadFromR2(translation.translated_docx_key);
      await uploadFileToDrive(token, aiDraftFolderId, 'ai_draft.docx', draftBuf, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      console.log('[repair-wo75] ✓ uploaded ai_draft.docx');
    } else {
      console.log('[repair-wo75] no translator_draft.docx key on record — skipped');
    }

    if (translation?.translated_preview_pdf_key) {
      const previewBuf = await downloadFromR2(translation.translated_preview_pdf_key);
      await uploadFileToDrive(token, aiDraftFolderId, 'preview.pdf', previewBuf, 'application/pdf');
      console.log('[repair-wo75] ✓ uploaded preview.pdf');
    } else {
      console.log('[repair-wo75] no preview PDF key on record — skipped');
    }
  }

  // ── Jira backfill ───────────────────────────────────────────────────────────
  if (!job.jira_issue_key) {
    console.error('[repair-wo75] job has no jira_issue_key — nothing to backfill on Jira');
    return;
  }

  const wantFields: Record<string, unknown> = {};
  if (driveUrl) wantFields[JIRA_FIELDS.documentsLink] = driveUrl;
  if (job.fulfillment_method === 'delivery') {
    if (job.delivery_phone) wantFields[JIRA_FIELDS.deliveryPhone] = job.delivery_phone;
    if (job.delivery_address) wantFields[JIRA_FIELDS.deliveryAddress] = job.delivery_address;
  }

  if (!APPLY) {
    console.log(`[repair-wo75] [dry-run] would check ${job.jira_issue_key} and patch any of these fields that are currently empty:`,
      Object.keys(wantFields));
    return;
  }

  const existing = await getExistingJiraFields(job.jira_issue_key);
  if (existing === null) {
    console.error('[repair-wo75] could not read existing Jira fields — check JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN');
    return;
  }

  const toPatch: Record<string, unknown> = {};
  for (const [fieldId, value] of Object.entries(wantFields)) {
    const current = existing[fieldId];
    if (current === null || current === undefined || current === '') {
      toPatch[fieldId] = value;
    }
  }

  if (Object.keys(toPatch).length === 0) {
    console.log(`[repair-wo75] ${job.jira_issue_key}: nothing to patch — all target fields already set`);
    return;
  }

  await patchJiraFields(job.jira_issue_key, toPatch);
  console.log(`[repair-wo75] ✓ patched ${job.jira_issue_key} fields:`, Object.keys(toPatch));
  console.log(`[repair-wo75] final Drive URL: ${driveUrl}`);
}

main().catch((err) => {
  console.error('[repair-wo75] FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
