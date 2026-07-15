/**
 * Idempotent Drive/Jira backfill for orders where initializeOrderIntegrations()
 * partially failed (e.g. the Drive OAuth token refresh error found in the WO-75
 * incident, 2026-07-09) — never overwrites data that's already correct.
 *
 * Safe to rerun:
 *   - Drive folder/subfolder creation is find-or-create (createOrderFolder ->
 *     getOrCreateFolder searches before creating).
 *   - Jira field patch (backfillJiraOrderFields) never overwrites a field that
 *     already has a value on the issue.
 *   - File uploads always create a new Drive file (Drive doesn't dedupe by name),
 *     so this repair is only safe to run once per job for the upload step —
 *     callers should check job.google_drive_folder_id first to avoid re-uploading
 *     into an already-repaired folder.
 *
 * dryRun mode makes no network calls — it only reports, from DB state, what an
 * apply run would attempt. It does not predict Jira's current live field values;
 * the apply run's own skip-if-already-set check is the real safety net for that.
 */
import { supabase, type JobRow, type DocumentRow, type TranslationRow } from './supabase';
import {
  createOrderFolder,
  uploadFileToDrive,
  getSubfolderId,
  isDriveConfigured,
  DRIVE_SUBFOLDER_NAMES,
} from './google-drive';
import { downloadFile } from './r2';
import { backfillJiraOrderFields, getPartnerApplicationId } from './integrations';

export interface RepairResult {
  jobId: string;
  dryRun: boolean;
  driveFolderAlreadyExisted: boolean;
  driveFolderCreated: boolean;
  driveFolderId: string | null;
  driveUrl: string | null;
  filesUploaded: string[];
  filesSkipped: string[];
  jiraIssueKey: string | null;
  jiraUpdatedFields: string[];
  jiraSkippedFields: string[];
  errors: string[];
}

export async function repairOrderIntegrations(jobId: string, dryRun: boolean): Promise<RepairResult> {
  const tag = `[integrations-repair:${jobId.slice(0, 8)}]${dryRun ? ' [dry-run]' : ''}`;
  const result: RepairResult = {
    jobId,
    dryRun,
    driveFolderAlreadyExisted: false,
    driveFolderCreated: false,
    driveFolderId: null,
    driveUrl: null,
    filesUploaded: [],
    filesSkipped: [],
    jiraIssueKey: null,
    jiraUpdatedFields: [],
    jiraSkippedFields: [],
    errors: [],
  };

  const { data: job, error: jobErr } = await supabase
    .from('jobs')
    .select('*')
    .eq('id', jobId)
    .single<JobRow>();

  if (jobErr || !job) {
    result.errors.push(`job not found: ${jobErr?.message ?? jobId}`);
    return result;
  }

  result.jiraIssueKey = job.jira_issue_key;

  const { data: doc } = await supabase
    .from('documents')
    .select('*')
    .eq('id', job.document_id)
    .single<DocumentRow>();

  if (!doc) {
    result.errors.push(`document not found: ${job.document_id}`);
    return result;
  }

  const { data: translation } = await supabase
    .from('translations')
    .select('*')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<TranslationRow>();

  // ── 1. Drive folder ────────────────────────────────────────────────────────
  let driveFolderId = job.google_drive_folder_id;
  let driveUrl = job.google_drive_folder_url;
  let sourceFolderId: string | null = null;
  let aiDraftFolderId: string | null = null;

  if (driveFolderId) {
    result.driveFolderAlreadyExisted = true;
    console.log(`${tag} Drive folder already exists: ${driveUrl}`);
  } else if (!isDriveConfigured()) {
    result.errors.push('Google Drive not configured (env vars missing) — cannot create folder');
  } else if (dryRun) {
    result.driveFolderCreated = true; // planned, not executed
    console.log(`${tag} would create Drive folder for job ${jobId}`);
  } else {
    try {
      const folder = await createOrderFolder(jobId);
      driveFolderId = folder.folderId;
      driveUrl = folder.folderUrl;
      sourceFolderId = folder.subfolders.source;
      aiDraftFolderId = folder.subfolders.aiDraft;
      result.driveFolderCreated = true;
      result.driveFolderId = driveFolderId;
      result.driveUrl = driveUrl;

      await supabase
        .from('jobs')
        .update({
          google_drive_folder_id: driveFolderId,
          google_drive_folder_url: driveUrl,
          drive_sync_status: 'created',
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', jobId);

      console.log(`${tag} ✓ Drive folder created: ${driveUrl}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Drive folder creation failed: ${msg}`);
      console.error(`${tag} Drive folder creation failed: ${msg}`);
    }
  }

  result.driveFolderId = driveFolderId;
  result.driveUrl = driveUrl;

  // ── 2. Upload original source + AI draft + preview PDF ─────────────────────
  const uploads: Array<{ label: string; key: string | null | undefined; subfolder: string; filename: string; mime: string }> = [
    { label: 'original', key: doc.file_key, subfolder: DRIVE_SUBFOLDER_NAMES.source, filename: 'source.pdf', mime: 'application/pdf' },
    { label: 'translator_draft.docx', key: translation?.translated_docx_key, subfolder: DRIVE_SUBFOLDER_NAMES.aiDraft, filename: 'ai_draft.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { label: 'preview.pdf', key: translation?.translated_preview_pdf_key, subfolder: DRIVE_SUBFOLDER_NAMES.aiDraft, filename: 'preview.pdf', mime: 'application/pdf' },
  ];

  for (const upload of uploads) {
    if (!upload.key) {
      result.filesSkipped.push(`${upload.label} (no R2 key on record)`);
      continue;
    }
    if (dryRun) {
      result.filesUploaded.push(`${upload.label} (would upload from R2 key ${upload.key})`);
      continue;
    }
    if (!driveFolderId) {
      result.filesSkipped.push(`${upload.label} (no Drive folder available)`);
      continue;
    }
    try {
      // Resolve the subfolder id lazily (repair may run against an already-existing
      // folder where we don't have subfolder ids in hand from this call).
      const folderId =
        upload.subfolder === DRIVE_SUBFOLDER_NAMES.source
          ? sourceFolderId ?? await getSubfolderId(driveFolderId, upload.subfolder).catch(() => null)
          : aiDraftFolderId ?? await getSubfolderId(driveFolderId, upload.subfolder).catch(() => null);
      if (!folderId) {
        result.filesSkipped.push(`${upload.label} (subfolder ${upload.subfolder} not found)`);
        continue;
      }
      const buf = await downloadFile(upload.key);
      await uploadFileToDrive(folderId, upload.filename, buf, upload.mime);
      result.filesUploaded.push(upload.label);
      console.log(`${tag} ✓ uploaded ${upload.label}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${upload.label} upload failed: ${msg}`);
      console.error(`${tag} ${upload.label} upload failed: ${msg}`);
    }
  }

  // ── 3. Backfill Jira fields (documentsLink + delivery address/phone + Partner ID) ──
  if (job.jira_issue_key) {
    // Same lookup initializeOrderIntegrations() uses at create time — reused here
    // so a referral that lands (or gets its application_id set) after issue
    // creation is not permanently stuck with an empty customfield_10121.
    const partnerApplicationId = await getPartnerApplicationId(jobId);

    if (dryRun) {
      const wouldPatch: string[] = [];
      if (driveUrl) wouldPatch.push('documentsLink');
      if (job.fulfillment_method === 'delivery') {
        if (job.delivery_phone) wouldPatch.push('deliveryPhone');
        if (job.delivery_address) wouldPatch.push('deliveryAddress');
      }
      if (partnerApplicationId) wouldPatch.push('partnerApplicationId');
      result.jiraUpdatedFields = wouldPatch.map((f) => `${f} (would patch if currently empty on the issue)`);
      console.log(`${tag} would attempt to backfill Jira ${job.jira_issue_key}: ${wouldPatch.join(', ') || '(nothing to backfill)'}`);
    } else {
      const patchResult = await backfillJiraOrderFields(job.jira_issue_key, {
        driveUrl,
        deliveryPhone: job.delivery_phone,
        deliveryAddress: job.delivery_address,
        fulfillmentMethod: job.fulfillment_method,
        partnerApplicationId,
      });
      if (!patchResult.ok) {
        result.errors.push(`Jira backfill failed: ${patchResult.error ?? 'unknown error'}`);
      }
      result.jiraUpdatedFields = patchResult.updatedFields;
      result.jiraSkippedFields = patchResult.skippedFields;
    }
  } else {
    result.errors.push('job has no jira_issue_key — nothing to backfill on Jira');
  }

  return result;
}
