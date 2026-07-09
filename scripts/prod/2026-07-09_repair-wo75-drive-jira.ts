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

// ─── Customer-facing status (mirrors src/lib/translation-workflow/customer-order-state.ts) ──
// Only the branches needed to answer "is payment_pending still shown, is the pay
// button visible" — kept intentionally narrow, not a full port of stage/progress logic.

function deriveCustomerStatusNarrow(jobStatus: string, workflowStatus: string | null): string {
  if (jobStatus === 'payment_pending') return 'payment_pending';
  if (jobStatus === 'failed') return 'failed';
  if (jobStatus === 'refunded') return 'refunded';
  if (jobStatus === 'canceled') return 'canceled';
  if (workflowStatus === 'translator_declined') return 'translator_declined';
  if (workflowStatus === 'notary_declined') return 'notary_declined';
  if (workflowStatus === 'delivered') return 'delivered';
  if (workflowStatus === 'picked_up') return 'picked_up';
  if (workflowStatus === 'out_for_delivery') return 'out_for_delivery';
  if (workflowStatus === 'ready_for_delivery') return 'ready_for_delivery';
  if (workflowStatus === 'ready_for_pickup') return 'ready_for_pickup';
  if (workflowStatus === 'notarized') return 'notarized';
  if (workflowStatus === 'notarization_in_progress') return 'notarization_in_progress';
  if (workflowStatus === 'assigned_to_notary') return 'assigned_to_notary';
  if (workflowStatus === 'translator_approved') return 'translator_approved';
  if (workflowStatus === 'awaiting_signature_stamp') return 'awaiting_signature_stamp';
  if (jobStatus === 'completed') {
    if (!workflowStatus) return 'completed';
    if (workflowStatus === 'awaiting_translator_review' || workflowStatus === 'completed') return 'awaiting_translator_review';
    return 'operator_processing';
  }
  switch (jobStatus) {
    case 'queued': return 'queued';
    case 'ocr_in_progress':
    case 'ocr_completed': return 'ocr_in_progress';
    case 'translation_in_progress': return 'translation_in_progress';
    case 'pdf_rendering': return 'pdf_rendering';
    default: return 'queued';
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n[repair-wo75] job=${JOB_ID} mode=${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const { data: job, error: jobErr } = await db
    .from('jobs')
    .select('id, document_id, status, progress_percent, workflow_status, service_level, fulfillment_method, delivery_phone, delivery_address, jira_issue_key, jira_issue_url, google_drive_folder_id, google_drive_folder_url, drive_sync_status, jira_sync_status, last_synced_at, price_kzt')
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

  const { data: paymentTx } = await db
    .from('payment_transactions')
    .select('id, status, amount, currency, paid_at, provider_transaction_id')
    .eq('job_id', JOB_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: quote } = await db
    .from('price_quotes')
    .select('id, status, amount_kzt, paid_at')
    .eq('job_id', JOB_ID)
    .order('quoted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // ── SECTION 1: customer-facing status ───────────────────────────────────────
  console.log('════════════════════════════════════════════════════════════');
  console.log('SECTION 1 — CUSTOMER-FACING STATUS (read-only, informational)');
  console.log('════════════════════════════════════════════════════════════');
  const customerStatus = deriveCustomerStatusNarrow(job.status, job.workflow_status);
  const payButtonVisible = customerStatus === 'payment_pending';
  console.log({
    'jobs.status': job.status,
    'jobs.workflow_status': job.workflow_status,
    'payment_transactions.status': paymentTx?.status ?? '(no payment_transactions row found)',
    'price_quotes.status': quote?.status ?? '(no price_quotes row found)',
    derivedCustomerStatus: customerStatus,
    dashboardShowsPaid: paymentTx?.status === 'paid',
    dashboardShowsPaymentPending: customerStatus === 'payment_pending',
    payButtonVisible,
  });
  console.log(
    payButtonVisible
      ? '[repair-wo75] ⚠ Pay button WOULD be visible — jobs.status is still payment_pending.'
      : '[repair-wo75] ✓ Pay button is HIDDEN — dashboard gates the entire quote/pay block on jobs.status === \'payment_pending\' only (src/app/[locale]/dashboard/page.tsx:283), which is independent of price_quotes.status. price_quotes.status has NO effect on what the customer sees.',
  );
  if (quote && quote.status !== 'paid' && paymentTx?.status === 'paid') {
    console.log(
      `[repair-wo75] ⚠ price_quotes ${quote.id} is still "${quote.status}" while payment_transactions ${paymentTx.id} is "paid" — ` +
      'stale from the pre-fix fire-and-forget markQuotePaid() bug. Does NOT affect the customer dashboard (confirmed above). ' +
      'NOT included in this repair — quote/payment status is out of scope for the Drive/Jira script and needs separate, explicit approval per payment-logic-change policy. See SECTION 5 below.',
    );
  }
  console.log('');

  // ── SECTION 2: current DB state ─────────────────────────────────────────────
  console.log('════════════════════════════════════════════════════════════');
  console.log('SECTION 2 — CURRENT DB STATE (jobs / documents / translations)');
  console.log('════════════════════════════════════════════════════════════');
  console.log({
    jiraIssueKey: job.jira_issue_key,
    jiraIssueUrl: job.jira_issue_url,
    driveFolderId: job.google_drive_folder_id,
    driveUrl: job.google_drive_folder_url,
    driveSyncStatus: job.drive_sync_status,
    jiraSyncStatus: job.jira_sync_status,
    lastSyncedAt: job.last_synced_at,
    fulfillmentMethod: job.fulfillment_method,
    hasDeliveryPhone: !!job.delivery_phone,
    hasDeliveryAddress: !!job.delivery_address,
    sourceFileKey: doc.file_key,
    translatorDraftKey: translation?.translated_docx_key ?? null,
    previewPdfKey: translation?.translated_preview_pdf_key ?? null,
  });
  console.log('');

  let driveFolderId: string | null = job.google_drive_folder_id;
  let driveUrl: string | null = job.google_drive_folder_url;
  // True once SECTION 3 determines a brand-new Drive folder would be created (dry-run
  // only — driveUrl itself isn't known yet at that point). Used by SECTION 4 so the
  // Jira documentsLink report doesn't silently disappear just because we don't have
  // the URL string yet — WO-75 incident, 2026-07-09: this was reported as "nothing to
  // patch" in dry-run even though --apply would correctly patch it once the folder
  // existed, because the report only checked driveUrl.startsWith('http').
  let folderWillBeCreated = false;
  const folderName = `WPO-${JOB_ID.slice(0, 8)}`;
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? '(GOOGLE_DRIVE_ROOT_FOLDER_ID not set)';

  // ── SECTION 3: Drive folder + file uploads ──────────────────────────────────
  console.log('════════════════════════════════════════════════════════════');
  console.log('SECTION 3 — GOOGLE DRIVE');
  console.log('════════════════════════════════════════════════════════════');

  const uploadPlan = [
    { label: 'original source file', key: doc.file_key, filename: 'source.pdf', subfolder: '01_SOURCE' },
    { label: 'translator_draft.docx', key: translation?.translated_docx_key ?? null, filename: 'ai_draft.docx', subfolder: '02_AI_DRAFT' },
    { label: 'preview PDF', key: translation?.translated_preview_pdf_key ?? null, filename: 'preview.pdf', subfolder: '02_AI_DRAFT' },
  ];

  if (driveFolderId) {
    console.log(`folderWouldBeCreated: false — already exists`);
    console.log(`folderPath: ${driveUrl} (id=${driveFolderId})`);
  } else if (!isDriveConfigured()) {
    console.log('folderWouldBeCreated: UNKNOWN — Google Drive not configured in this shell (GOOGLE_* env vars missing)');
  } else {
    // Read-only live check — does a folder with this name already exist under root,
    // even though the DB doesn't know about it? Safe (GET only), no write.
    let liveExistingId: string | null = null;
    let liveCheckError: string | null = null;
    try {
      const token = await getDriveToken();
      liveExistingId = await findExistingFolder(token, folderName, rootFolderId);
    } catch (err) {
      liveCheckError = err instanceof Error ? err.message : String(err);
    }

    if (liveCheckError) {
      console.log(`folderWouldBeCreated: UNKNOWN — live Drive check failed: ${liveCheckError}`);
    } else if (liveExistingId) {
      console.log(`folderWouldBeCreated: false — a folder named "${folderName}" already exists in Drive (id=${liveExistingId}) but is NOT recorded in jobs.google_drive_folder_id. Repair would adopt it (find-or-create), not duplicate it.`);
      driveUrl = `https://drive.google.com/drive/folders/${liveExistingId}`;
    } else {
      console.log(`folderWouldBeCreated: true`);
      console.log(`folderName: "${folderName}"`);
      console.log(`folderPath (planned): Drive root (${rootFolderId}) / ${folderName} / {${DRIVE_SUBFOLDERS.join(', ')}}`);
      folderWillBeCreated = true;
      // driveUrl intentionally stays null here — the real URL isn't known until the
      // folder is actually created. SECTION 4 below still reports documentsLink as a
      // field that WOULD be patched, using folderWillBeCreated to know it needs to.
    }
  }

  console.log('\nfilesWouldBeUploaded:');
  for (const item of uploadPlan) {
    if (!item.key) {
      console.log(`  - ${item.label}: SKIP — no R2 key on record`);
    } else {
      console.log(`  - ${item.label}: from R2 key "${item.key}" → Drive ${item.subfolder}/${item.filename}`);
    }
  }
  if (driveFolderId) {
    console.log(
      '  ⚠ NOTE: jobs.google_drive_folder_id was already set before this run, meaning a prior partial ' +
      'attempt created this folder. This script does not check whether these files were already uploaded ' +
      'into it — Drive does not dedupe by filename, so re-running the upload step against an already-populated ' +
      'folder would create duplicates. Verify the folder contents in Drive before approving --apply for this job.',
    );
  }

  console.log('\njobs row fields that WOULD be updated (only if folder creation runs):');
  console.log('  google_drive_folder_id  : (new folder id)');
  console.log('  google_drive_folder_url : (new folder url)');
  console.log('  drive_sync_status       : "created"');
  console.log('  last_synced_at          : (current timestamp)');
  console.log(driveFolderId ? '  → SKIPPED: folder already recorded, no jobs update needed.' : '');
  console.log('');

  if (APPLY && !driveFolderId && isDriveConfigured()) {
    const token = await getDriveToken();
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

  // ── SECTION 4: Jira backfill ─────────────────────────────────────────────────
  console.log('════════════════════════════════════════════════════════════');
  console.log('SECTION 4 — JIRA FIELD BACKFILL');
  console.log('════════════════════════════════════════════════════════════');

  if (!job.jira_issue_key) {
    console.log('[repair-wo75] job has no jira_issue_key — nothing to backfill on Jira');
    console.log('');
  } else {
    // documentsLink is reported whenever a URL is either already known (existing
    // folder) OR will exist after SECTION 3 creates one — even though we don't have
    // the actual URL string yet in that second case. `patchable: false` means "this
    // field would be touched by --apply, but this dry-run can't show the exact value
    // because the folder doesn't exist yet" — it must never be silently dropped from
    // the report just because the URL string isn't known.
    const wantFields: Record<string, { label: string; value: string | null; patchable: boolean }> = {};
    const haveRealDriveUrl = driveUrl !== null && driveUrl.startsWith('http');
    if (haveRealDriveUrl) {
      wantFields[JIRA_FIELDS.documentsLink] = { label: 'Drive folder URL', value: driveUrl, patchable: true };
    } else if (folderWillBeCreated) {
      wantFields[JIRA_FIELDS.documentsLink] = { label: 'Drive folder URL', value: null, patchable: false };
    }
    if (job.fulfillment_method === 'delivery') {
      if (job.delivery_phone) wantFields[JIRA_FIELDS.deliveryPhone] = { label: 'delivery phone', value: job.delivery_phone, patchable: true };
      if (job.delivery_address) wantFields[JIRA_FIELDS.deliveryAddress] = { label: 'delivery address', value: job.delivery_address, patchable: true };
    }

    // Read-only live check against the actual Jira issue — safe in dry-run too.
    const existing = await getExistingJiraFields(job.jira_issue_key);
    if (existing === null) {
      console.log(`[repair-wo75] could not read live Jira fields for ${job.jira_issue_key} — check JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN`);
    } else {
      const toPatch: Record<string, unknown> = {};
      const pendingFields: string[] = []; // empty on Jira, needs patching, but value not known yet (pre-folder-creation)
      console.log(`issue: ${job.jira_issue_key}`);
      for (const [fieldId, { label, value, patchable }] of Object.entries(wantFields)) {
        const current = existing[fieldId];
        const isEmpty = current === null || current === undefined || current === '';
        if (!isEmpty) {
          console.log(`  - ${label} (${fieldId}): already set to "${current}" (skip, never overwritten)`);
        } else if (patchable && value !== null) {
          toPatch[fieldId] = value;
          console.log(`  - ${label} (${fieldId}): currently EMPTY → would set to "${value}"`);
        } else {
          pendingFields.push(fieldId);
          console.log(`  - ${label} (${fieldId}): currently EMPTY → WOULD be patched by --apply, with the new Drive folder's URL (not yet known — folder does not exist yet, SECTION 3 creates it first, in the same --apply run, before this patch happens)`);
        }
      }
      if (Object.keys(toPatch).length === 0 && pendingFields.length === 0) {
        console.log('  → nothing to patch, all target fields already set');
      }

      if (APPLY && Object.keys(toPatch).length > 0) {
        await patchJiraFields(job.jira_issue_key, toPatch);
        console.log(`[repair-wo75] ✓ patched ${job.jira_issue_key} fields:`, Object.keys(toPatch));
      }
    }
    console.log('');
  }

  // ── SECTION 5: price_quotes status (report only — no action taken here) ─────
  console.log('════════════════════════════════════════════════════════════');
  console.log('SECTION 5 — PRICE QUOTE STATUS (report only, NOT touched by this script)');
  console.log('════════════════════════════════════════════════════════════');
  if (!quote) {
    console.log('no price_quotes row found for this job');
  } else {
    console.log({
      quoteId: quote.id,
      quoteStatus: quote.status,
      quoteAmountKzt: quote.amount_kzt,
      quotePaidAt: quote.paid_at,
      paymentTransactionStatus: paymentTx?.status ?? null,
      needsBackfillToPaid: quote.status !== 'paid' && paymentTx?.status === 'paid',
    });
    if (quote.status !== 'paid' && paymentTx?.status === 'paid') {
      console.log(
        '[repair-wo75] This quote needs a one-time backfill to status=paid (root cause already fixed going forward — ' +
        'markQuotePaid is now awaited in the Halyk callback). This script does not perform that write. ' +
        'Confirmed dashboard-safe to leave as-is for now (SECTION 1). Propose separately if you want it backfilled.',
      );
    } else {
      console.log('[repair-wo75] quote status is consistent with payment status — no backfill needed.');
    }
  }
  console.log('');
  console.log(`[repair-wo75] mode was ${APPLY ? 'APPLY' : 'DRY RUN'} — ${APPLY ? 'writes above were applied.' : 'no writes were made.'}`);
}

main().catch((err) => {
  console.error('[repair-wo75] FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
