#!/usr/bin/env npx tsx
/**
 * inspect-customer-order.ts — read-only support CLI (2026-07-31).
 *
 * Builds a full picture of one real customer order — job/pricing/documents/analysis/
 * AI drafts/artifacts/Drive/integration-error state — plus the EXACT customer-visible
 * dashboard projection, by calling the real dashboard selector
 * (getCustomerOrderState, src/lib/translation-workflow/customer-order-state.ts) rather
 * than re-deriving statuses/download-availability by hand.
 *
 * Strictly read-only: every DB call is `.select()`; R2 is only ever `.head()`ed
 * (existence-only, via src/lib/r2/client.ts's headFile) — never downloaded, never a
 * signed URL generated, never a write of any kind. Companion to
 * scripts/support/inspect-customer-order.sql (same sections, for a human running raw
 * SQL directly in the Supabase SQL Editor) — see
 * docs/operations/customer-order-inspection.md for how to use both together.
 *
 * Usage:
 *   npx tsx scripts/support/inspect-customer-order.ts --job-id <UUID> [--json] [--markdown]
 *
 * Env: loads .env.production.local then .env.staging.local (first one present per
 * variable wins, same convention as every other scripts/prod|staging/*.ts tool) — run
 * `vercel env pull .env.production.local --environment=production` yourself first if
 * investigating a real production order. Never logs credential values.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  getCustomerOrderState,
  type CustomerOrderState,
} from '../../src/lib/translation-workflow/customer-order-state';

// ─── Env loading (existing project convention) ────────────────────────────────
const ROOT = path.resolve(process.cwd());
function loadEnvFile(filename: string): boolean {
  const filepath = path.join(ROOT, filename);
  // quiet: true — dotenv's own "injected env" banner otherwise prints to stdout, which
  // would corrupt --json output piped into another tool.
  if (fs.existsSync(filepath)) { dotenv.config({ path: filepath, quiet: true }); return true; }
  return false;
}
loadEnvFile('.env.production.local');
loadEnvFile('.env.staging.local');
// r2/client.ts (dynamically imported below, only if we actually check R2) reads
// src/lib/env.ts's NODE_ENV-gated Zod schema — this CLI is not "the app running", so
// give it a valid value if the shell didn't already set one.
process.env.NODE_ENV = (process.env.NODE_ENV as 'development' | 'test' | 'production' | undefined) ?? 'production';

// ─── CLI args ──────────────────────────────────────────────────────────────────
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const jobId = arg('job-id');
const asJson = flag('json');
const asMarkdown = flag('markdown');

if (!jobId) {
  console.error('Usage: npx tsx scripts/support/inspect-customer-order.ts --job-id <UUID> [--json] [--markdown]');
  process.exit(1);
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (!UUID_RE.test(jobId)) {
  console.error(`--job-id must be a UUID, got: ${jobId}`);
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('[inspect-customer-order] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('  vercel env pull .env.production.local --environment=production');
  process.exit(1);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(supabaseUrl, serviceKey) as any;

// ─── Data shapes (real columns only — see inspect-customer-order.sql for the same
// sections in raw SQL, and the audit in this PR for the schema notes) ────────────
interface JobRow {
  id: string; document_id: string; status: string; workflow_status: string | null;
  service_level: string | null; notarized: boolean; notary_city: string | null;
  fulfillment_method: string | null; delivery_phone: string | null; delivery_address: string | null;
  applicant_type: string | null; notary_urgency_level: string | null; notary_urgency_window: string | null;
  notary_urgency_multiplier: number | null; notary_urgency_cutoff_at: string | null; notary_urgency_fee_kzt: number | null;
  progress_percent: number; error_message: string | null; priority: number; payment_source: string | null;
  price_kzt: number | null; price_before_discount_kzt: number | null; discount_applied_kzt: number | null;
  discount_code: string | null; manual_adjustment_kzt: number | null; customer_comment: string | null;
  started_at: string | null; completed_at: string | null; created_at: string;
  jira_issue_id: string | null; jira_issue_key: string | null; jira_issue_url: string | null;
  jira_sync_status: string | null; google_drive_folder_id: string | null; google_drive_folder_url: string | null;
  drive_sync_status: string | null; last_integration_error: string | null; last_synced_at: string | null;
  price_jira_sync_status: string | null; price_jira_last_error: string | null;
  finance_jira_sync_status: string | null; finance_jira_last_error: string | null;
}
interface DocumentRow {
  id: string; user_id: string; filename: string; original_file_size: number; file_key: string;
  source_language: string; target_language: string; document_type: string; status: string;
  detected_source_language: string | null; created_at: string; updated_at: string;
}
interface QuoteRow {
  id: string; status: string; amount_kzt: number; currency: string; formula_version: string | null;
  source_character_count_with_spaces: number | null; physical_page_count: number | null;
  quoted_at: string; expires_at: string; paid_at: string | null; created_at: string;
}
interface PaymentRow {
  id: string; status: string; amount: number; currency: string; payment_provider: string | null;
  provider_transaction_id: string | null; paid_at: string | null; failed_at: string | null; created_at: string;
}
interface DraftRow {
  id: string; status: string;
  file_keys: Array<{ key: string; originalName: string; sizeBytes: number; sourceUploadCount?: number; sourceUploadIds?: string[]; sourceContentHashes?: string[] }>;
  analysis_snapshot: { method: string; characterCount: number; physicalPageCount: number | null; sourceUploadCount?: number; sourceUploadIds?: string[] } | null;
  converted_job_id: string | null;
}
interface AnalysisRow {
  id: string; revision: number; status: string; method: string | null;
  source_character_count_with_spaces: number | null; physical_page_count: number | null;
  content_sha256: string | null; failure_reason: string | null; created_at: string;
}
interface TranslationRow {
  id: string; translated_markdown: string | null; translated_pdf_key: string | null;
  translated_docx_key: string | null; translated_preview_pdf_key: string | null;
  qa_report: Record<string, unknown> | null; created_at: string;
}
interface OcrRow { id: string; page_count: number; detected_language: string | null; provider: string; created_at: string }
interface AuditRow { actor: string; source: string; action: string; previous_status: string | null; new_status: string | null; created_at: string }

async function main(): Promise<void> {
  // Progress/diagnostic output goes to stderr — stdout must be pure report content so
  // --json can be piped straight into jq/another parser.
  console.error(`[inspect-customer-order] Connected: ${supabaseUrl!.replace(/\/\/.*@/, '//***@')}`);
  console.error(`[inspect-customer-order] job_id: ${jobId}`);

  const { data: job, error: jobError } = await db.from('jobs').select('*').eq('id', jobId).maybeSingle();
  if (jobError) { console.error('Could not query jobs:', jobError.message); process.exit(1); }
  if (!job) { console.error(`No job found with id ${jobId}`); process.exit(1); }
  const j = job as JobRow;

  const { data: doc } = await db.from('documents').select('*').eq('id', j.document_id).maybeSingle();
  const document = doc as DocumentRow | null;

  const { data: quotes } = await db.from('price_quotes').select('*').eq('job_id', jobId).order('created_at', { ascending: false });
  const { data: payments } = await db.from('payment_transactions').select('*').eq('job_id', jobId).order('created_at', { ascending: false });
  const { data: analyses } = document
    ? await db.from('document_analysis').select('*').eq('document_id', document.id).order('revision', { ascending: false })
    : { data: [] };
  const { data: translations } = await db.from('translations').select('*').eq('job_id', jobId).order('created_at', { ascending: false });
  const { data: ocrResults } = await db.from('ocr_results').select('*').eq('job_id', jobId).order('created_at', { ascending: false });
  const { data: auditLog } = await db.from('job_audit_log').select('actor, source, action, previous_status, new_status, created_at').eq('job_id', jobId).order('created_at', { ascending: true });
  const { data: draft } = await db.from('order_drafts').select('id, status, file_keys, analysis_snapshot, converted_job_id').eq('converted_job_id', jobId).maybeSingle();

  const translation = (translations?.[0] as TranslationRow | undefined) ?? null;
  const draftRow = draft as DraftRow | null;

  // ─── R2 existence checks (HEAD only — never downloaded) ─────────────────────
  let r2: { sourceExists: boolean | 'unknown'; pdfExists: boolean | 'unknown'; docxExists: boolean | 'unknown' } = {
    sourceExists: 'unknown', pdfExists: 'unknown', docxExists: 'unknown',
  };
  try {
    const { headFile } = await import('@/lib/r2/client');
    r2 = {
      sourceExists: document ? (await headFile(document.file_key)) !== null : 'unknown',
      pdfExists: translation?.translated_pdf_key ? (await headFile(translation.translated_pdf_key)) !== null : 'unknown',
      docxExists: translation?.translated_docx_key ? (await headFile(translation.translated_docx_key)) !== null : 'unknown',
    };
  } catch (err) {
    console.error('[inspect-customer-order] R2 existence check unavailable (credentials/connectivity):', err instanceof Error ? err.message : String(err));
  }

  // ─── Customer dashboard projection — REUSES the real selector, never re-derives it ───
  const state: CustomerOrderState = getCustomerOrderState({
    jobStatus: j.status,
    progressPercent: j.progress_percent,
    workflowStatus: j.workflow_status,
    serviceLevel: j.service_level,
    fulfillmentMethod: (j.fulfillment_method as 'pickup' | 'delivery' | null) ?? null,
  });

  // "Individual download" and "download-all" are the SAME single boolean in this system —
  // there is exactly one downloadable object per job (or zero for notarized). Reported
  // honestly rather than inventing a distinction the product doesn't have.
  const individualDownloadAvailable = state.canDownload;
  const downloadAllAvailable = 'not_applicable' as const;

  const missingExpectedArtifacts: string[] = [];
  if (j.status === 'completed' && !translation) {
    missingExpectedArtifacts.push('job.status=completed but no translations row exists at all');
  }
  if (translation && !translation.translated_pdf_key) {
    missingExpectedArtifacts.push('translations row exists but translated_pdf_key is null');
  }
  if (translation?.translated_pdf_key && r2.pdfExists === false) {
    missingExpectedArtifacts.push(`translated_pdf_key (${translation.translated_pdf_key}) is set but the R2 object does not exist`);
  }
  if (
    j.service_level === 'official_with_translator_signature_and_provider_stamp' &&
    ['ready_for_delivery', 'delivered'].includes(j.workflow_status ?? '') &&
    !translation?.translated_docx_key
  ) {
    missingExpectedArtifacts.push('Official workflow reached ready_for_delivery/delivered but translated_docx_key is null');
  }
  if (document && r2.sourceExists === false) {
    missingExpectedArtifacts.push(`documents.file_key (${document.file_key}) is set but the R2 object does not exist`);
  }

  const orphanArtifactFindings: string[] = [];
  if (!draftRow) {
    orphanArtifactFindings.push('No order_drafts row links to this job (dashboard upload-card order, or a pre-2026-07-29 draft) — per-original-file mapping does not exist for this order; only the single merged file_key is available.');
  } else {
    const sourceUploadCount = draftRow.analysis_snapshot?.sourceUploadCount ?? draftRow.file_keys?.[0]?.sourceUploadCount;
    if (sourceUploadCount != null && sourceUploadCount > 1) {
      orphanArtifactFindings.push(`Multi-file order: ${sourceUploadCount} distinct source uploads were merged into one file at intake. No per-source-file AI draft/artifact breakdown exists downstream — the single translations row covers all of them combined.`);
    }
  }

  const report = {
    jobId,
    job: j,
    document,
    quotes: (quotes ?? []) as QuoteRow[],
    payments: (payments ?? []) as PaymentRow[],
    documentAnalysis: (analyses ?? []) as AnalysisRow[],
    translation,
    ocrResults: (ocrResults ?? []) as OcrRow[],
    auditLog: (auditLog ?? []) as AuditRow[],
    orderDraft: draftRow,
    r2Existence: r2,
    customerDashboardProjection: {
      customerStatus: state.customerStatus,
      progressPercent: state.progressPercent,
      isActive: state.isActive,
      isTerminal: state.isTerminal,
      stages: state.stages,
      individualDownloadAvailable,
      downloadAllAvailable,
    },
    findings: {
      missingExpectedArtifacts,
      orphanArtifactFindings,
    },
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (asMarkdown) {
    console.log(renderMarkdown(report));
    return;
  }
  console.log(renderText(report));
}

interface Report {
  jobId: string; job: JobRow; document: DocumentRow | null; quotes: QuoteRow[]; payments: PaymentRow[];
  documentAnalysis: AnalysisRow[]; translation: TranslationRow | null; ocrResults: OcrRow[]; auditLog: AuditRow[];
  orderDraft: DraftRow | null; r2Existence: { sourceExists: boolean | 'unknown'; pdfExists: boolean | 'unknown'; docxExists: boolean | 'unknown' };
  customerDashboardProjection: {
    customerStatus: string; progressPercent: number; isActive: boolean; isTerminal: boolean;
    stages: Array<{ key: string; labelKey: string; done: boolean; current: boolean }>;
    individualDownloadAvailable: boolean; downloadAllAvailable: 'not_applicable';
  };
  findings: { missingExpectedArtifacts: string[]; orphanArtifactFindings: string[] };
}

function renderText(r: Report): string {
  const lines: string[] = [];
  lines.push(`=== Job ${r.jobId} ===`);
  lines.push(`status: ${r.job.status}  workflow_status: ${r.job.workflow_status ?? '(none)'}  service_level: ${r.job.service_level}`);
  lines.push(`document: ${r.document?.filename ?? '(not found)'}  (${r.document?.source_language} -> ${r.document?.target_language})`);
  lines.push(`price_kzt: ${r.job.price_kzt}  notarized: ${r.job.notarized}  fulfillment_method: ${r.job.fulfillment_method ?? '(n/a)'}`);
  lines.push('');
  lines.push('=== Quotes ===');
  if (r.quotes.length === 0) lines.push('(none)');
  for (const q of r.quotes) lines.push(`  ${q.id}  status=${q.status}  amount=${q.amount_kzt} ${q.currency}  formula_version=${q.formula_version ?? '(none)'}`);
  lines.push('');
  lines.push('=== Payments ===');
  if (r.payments.length === 0) lines.push('(none)');
  for (const p of r.payments) lines.push(`  ${p.id}  status=${p.status}  amount=${p.amount} ${p.currency}  provider=${p.payment_provider ?? '(none)'}`);
  lines.push('');
  lines.push('=== Document analysis ===');
  if (r.documentAnalysis.length === 0) lines.push('(none)');
  for (const a of r.documentAnalysis) lines.push(`  rev ${a.revision}  status=${a.status}  method=${a.method ?? '(none)'}  chars=${a.source_character_count_with_spaces ?? '(none)'}  pages=${a.physical_page_count ?? '(none)'}`);
  lines.push('');
  lines.push('=== Source uploads (pre-merge, order_drafts only) ===');
  if (!r.orderDraft) {
    lines.push('(no linked order_draft — see findings.orphanArtifactFindings)');
  } else {
    const fk = r.orderDraft.file_keys?.[0];
    lines.push(`  merged file: ${fk?.originalName ?? '(none)'}  sourceUploadCount=${fk?.sourceUploadCount ?? '(unset — pre-fix draft)'}`);
    lines.push(`  sourceUploadIds: ${JSON.stringify(fk?.sourceUploadIds ?? [])}`);
  }
  lines.push('');
  lines.push('=== AI drafts / OCR (whole merged document, not per source file) ===');
  if (!r.translation) lines.push('(no translations row)');
  else lines.push(`  translated_pdf_key=${r.translation.translated_pdf_key ?? '(none)'}  translated_docx_key=${r.translation.translated_docx_key ?? '(none)'}  translated_preview_pdf_key=${r.translation.translated_preview_pdf_key ?? '(none)'}`);
  for (const o of r.ocrResults) lines.push(`  OCR: provider=${o.provider}  pages=${o.page_count}  language=${o.detected_language ?? '(none)'}`);
  lines.push('');
  lines.push('=== R2 object existence (HEAD only, never downloaded) ===');
  lines.push(`  source file_key exists: ${r.r2Existence.sourceExists}`);
  lines.push(`  translated_pdf_key exists: ${r.r2Existence.pdfExists}`);
  lines.push(`  translated_docx_key exists: ${r.r2Existence.docxExists}`);
  lines.push('');
  lines.push('=== Google Drive / integrations ===');
  lines.push(`  google_drive_folder_url: ${r.job.google_drive_folder_url ?? '(none)'}  drive_sync_status: ${r.job.drive_sync_status ?? '(none)'}`);
  lines.push(`  jira_issue_key: ${r.job.jira_issue_key ?? '(none)'}  jira_sync_status: ${r.job.jira_sync_status ?? '(none)'}`);
  lines.push(`  last_integration_error: ${r.job.last_integration_error ?? '(none)'}`);
  lines.push(`  price_jira_last_error: ${r.job.price_jira_last_error ?? '(none)'}  finance_jira_last_error: ${r.job.finance_jira_last_error ?? '(none)'}`);
  lines.push('');
  lines.push('=== Customer dashboard projection (from getCustomerOrderState — the REAL selector) ===');
  const p = r.customerDashboardProjection;
  lines.push(`  customerStatus: ${p.customerStatus}  progressPercent: ${p.progressPercent}%  isActive: ${p.isActive}  isTerminal: ${p.isTerminal}`);
  lines.push(`  individual download available: ${p.individualDownloadAvailable}`);
  lines.push(`  download-all available: ${p.downloadAllAvailable} (this system has no multi-artifact download-all feature — one file per job, or none for notarized)`);
  lines.push(`  stages: ${p.stages.map((s) => `${s.key}${s.current ? '*' : s.done ? '(done)' : ''}`).join(' -> ')}`);
  lines.push('');
  lines.push('=== Findings ===');
  lines.push('Missing expected artifacts:');
  if (r.findings.missingExpectedArtifacts.length === 0) lines.push('  (none)');
  for (const f of r.findings.missingExpectedArtifacts) lines.push(`  - ${f}`);
  lines.push('Orphan / unmapped artifact notes:');
  if (r.findings.orphanArtifactFindings.length === 0) lines.push('  (none)');
  for (const f of r.findings.orphanArtifactFindings) lines.push(`  - ${f}`);
  return lines.join('\n');
}

function renderMarkdown(r: Report): string {
  const p = r.customerDashboardProjection;
  const lines: string[] = [];
  lines.push(`# Order inspection — job \`${r.jobId}\``);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|---|---|`);
  lines.push(`| job status | ${r.job.status} |`);
  lines.push(`| workflow status | ${r.job.workflow_status ?? '(none)'} |`);
  lines.push(`| service level | ${r.job.service_level} |`);
  lines.push(`| customer-visible status | **${p.customerStatus}** |`);
  lines.push(`| individual download available | ${p.individualDownloadAvailable} |`);
  lines.push(`| download-all available | ${p.downloadAllAvailable} (feature does not exist) |`);
  lines.push('');
  lines.push('## Missing expected artifacts');
  if (r.findings.missingExpectedArtifacts.length === 0) lines.push('- (none)');
  for (const f of r.findings.missingExpectedArtifacts) lines.push(`- ${f}`);
  lines.push('');
  lines.push('## Orphan / unmapped artifact notes');
  if (r.findings.orphanArtifactFindings.length === 0) lines.push('- (none)');
  for (const f of r.findings.orphanArtifactFindings) lines.push(`- ${f}`);
  lines.push('');
  lines.push('## Raw data');
  lines.push('```json');
  lines.push(JSON.stringify(r, null, 2));
  lines.push('```');
  return lines.join('\n');
}

main().catch((err) => {
  console.error('[inspect-customer-order] FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
