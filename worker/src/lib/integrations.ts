/**
 * Worker integration helpers: Drive folder creation + Jira issue creation +
 * translator review notification + Telegram.
 *
 * initializeOrderIntegrations — runs BEFORE OCR, creates Drive folder + Jira issue.
 * triggerTranslatorReview     — runs AFTER AI draft, uploads draft to Drive 02_AI_DRAFT.
 *
 * Jira credentials: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN.
 * Jira project config: JIRA_PROJECT_KEY (default: WO), JIRA_ISSUE_TYPE_NAME (default: Заказ).
 * Drive config: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_DRIVE_ROOT_FOLDER_ID.
 *
 * All Jira-internal transitions (assignee, security level, status, notifications) are
 * handled by Jira Automation — WPO does NOT call those APIs.
 */

import { supabase } from './supabase';
import {
  createOrderFolder,
  uploadFileToDrive,
  getSubfolderId,
  isDriveConfigured,
  DRIVE_SUBFOLDER_NAMES,
} from './google-drive';
import { downloadFile } from './r2';
import type { ServiceLevel } from './output-plan';
import { buildJiraIssueFields, JIRA_FIELDS } from './jira/order-fields';
import {
  buildFinanceIssuePayload,
  getFinanceConfig,
  type FinanceReportParams,
  type PricingResult,
} from './jira/finance-report';
import {
  buildPriceBreakdownPayload,
  buildPriceBreakdownDescription,
  getPriceBreakdownConfig,
  mapPriceQuote,
  mapPriceQuoteItem,
  mapCostReservation,
  type PriceBreakdownFullParams,
  type DbPriceQuote,
  type DbPriceQuoteItem,
  type DbCostReservation,
  buildPriceBreakdownSummary,
} from './jira/price-breakdown';

// ─── Jira helpers ─────────────────────────────────────────────────────────────

function getJiraAuth(): { baseUrl: string; authHeader: string } | null {
  const baseUrl = process.env.JIRA_BASE_URL;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  if (!baseUrl || !email || !token) return null;
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    authHeader: 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64'),
  };
}

async function jiraFetch(path: string, options: RequestInit = {}): Promise<Response | null> {
  const auth = getJiraAuth();
  if (!auth) return null;
  try {
    return fetch(`${auth.baseUrl}/rest/api/3${path}`, {
      ...options,
      headers: {
        Authorization: auth.authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers as Record<string, string> ?? {}),
      },
    });
  } catch (e) {
    console.error(`[worker-jira] fetch ${path} error:`, e instanceof Error ? e.message : e);
    return null;
  }
}

function serviceLevelLabel(level: ServiceLevel): string {
  if (level === 'notarization_through_partners') return 'notarized';
  if (level === 'official_with_translator_signature_and_provider_stamp') return 'certified';
  return 'electronic';
}

async function createJiraIssue(params: {
  jobId: string;
  customerId: string | null;
  serviceLevel: ServiceLevel;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  notaryCity?: string | null;
  fulfillmentMethod?: 'pickup' | 'delivery' | null;
  deliveryPhone?: string | null;
  deliveryAddress?: string | null;
  paymentSource?: 'card_payment' | 'subscription' | null;
  driveUrl?: string | null;
  wpoUrl: string;
  createdAt?: string;
  customerComment?: string | null;
}): Promise<{ issueKey: string; issueId: string; issueUrl: string } | null> {
  const auth = getJiraAuth();
  if (!auth) {
    console.log('[worker-jira] Jira not configured — skipping issue creation');
    return null;
  }

  const projectKey = process.env.JIRA_PROJECT_KEY ?? 'WO';

  // Safe description (no PII, no document content)
  const descLines: string[] = [
    `Job ID: ${params.jobId}`,
    `Service: ${serviceLevelLabel(params.serviceLevel)}`,
    `Languages: ${params.sourceLang} → ${params.targetLang}`,
    `Document type: ${params.documentType.split('|')[0] ?? params.documentType}`,
    params.notaryCity ? `Notary city: ${params.notaryCity}` : null,
    params.fulfillmentMethod ? `Fulfillment: ${params.fulfillmentMethod}` : null,
    params.driveUrl ? `Drive: ${params.driveUrl}` : null,
    `WPO order: ${params.wpoUrl}`,
    params.createdAt ? `Created: ${params.createdAt}` : null,
    `Комментарий клиента: ${params.customerComment?.trim() || 'не указан'}`,
  ].filter((x): x is string => x !== null);

  const customFields = buildJiraIssueFields({
    orderId: params.jobId,
    customerId: params.customerId,
    sourceLang: params.sourceLang,
    targetLang: params.targetLang,
    documentType: params.documentType,
    serviceLevel: params.serviceLevel,
    paymentSource: params.paymentSource ?? null,
    fulfillmentMethod: params.fulfillmentMethod ?? null,
    deliveryPhone: params.deliveryPhone ?? null,
    deliveryAddress: params.deliveryAddress ?? null,
    driveUrl: params.driveUrl ?? null,
  });

  const envLabel = (process.env.APP_ENV ?? 'production') === 'staging'
    ? 'wpo-staging'
    : 'wpo-production';

  const body = {
    fields: {
      project: { key: projectKey },
      issuetype: { name: 'Заказ' },
      summary: params.jobId,
      description: {
        type: 'doc',
        version: 1,
        content: descLines.map((text) => ({
          type: 'paragraph',
          content: [{ type: 'text', text }],
        })),
      },
      labels: [envLabel],
      ...customFields,
    },
  };

  const res = await jiraFetch('/issue', { method: 'POST', body: JSON.stringify(body) });
  if (!res) return null;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jira createIssue failed: ${res.status} ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { id: string; key: string };
  return {
    issueId: data.id,
    issueKey: data.key,
    issueUrl: `${auth.baseUrl}/browse/${data.key}`,
  };
}

// ─── Jira issue link ─────────────────────────────────────────────────────────

async function createJiraIssueLink(inwardIssueKey: string, outwardIssueKey: string): Promise<void> {
  const res = await jiraFetch('/issueLink', {
    method: 'POST',
    body: JSON.stringify({
      type: { name: 'Relates' },
      inwardIssue: { key: inwardIssueKey },
      outwardIssue: { key: outwardIssueKey },
    }),
  });
  if (!res) return; // Jira not configured — already logged by jiraFetch
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn('[worker-jira] createJiraIssueLink failed', { status: res.status, body: text.slice(0, 200) });
  }
}

// ─── Finance report issue ─────────────────────────────────────────────────────

/**
 * Create a separate Finance Report Story in Jira for the given order.
 * Always non-blocking — never throws to the caller; returns issue key or null.
 *
 * If JIRA_FINANCE_SECURITY_LEVEL_ID is absent, creates without security field.
 * Labels (wpo-finance, confidential, internal-finance) act as fallback access control.
 */
export async function createFinanceReportIssue(params: {
  jobId: string;
  mainIssueKey: string;
  pricingSnapshot: Record<string, unknown> | null;
  quoteId: string | null;
  serviceLevel: string;
  sourceLanguage: string;
  targetLanguage: string;
  documentType: string;
  paymentTransactionId: string | null;
  paymentAmountKzt: number | null;
  paymentStatus: string | null;
  fiscalStatus: string | null;
  fiscalReceiptId: string | null;
  customerComment: string | null;
}): Promise<string | null> {
  const tag = `[finance-jira:${params.jobId.slice(0, 8)}]`;

  if (!getJiraAuth()) {
    console.log(`${tag} Jira not configured — skipping finance report`);
    return null;
  }

  // Idempotency check
  const { data: existingJob } = await supabase
    .from('jobs')
    .select('finance_jira_issue_key')
    .eq('id', params.jobId)
    .maybeSingle();

  const existingKey = (existingJob as Record<string, unknown> | null)?.finance_jira_issue_key as string | null;
  if (existingKey) {
    console.log(`${tag} Finance issue already exists: ${existingKey}`);
    return existingKey;
  }

  const reportParams: FinanceReportParams = {
    jobId: params.jobId,
    mainIssueKey: params.mainIssueKey,
    quoteId: params.quoteId,
    serviceLevel: params.serviceLevel,
    sourceLanguage: params.sourceLanguage,
    targetLanguage: params.targetLanguage,
    documentType: params.documentType,
    pricingResult: params.pricingSnapshot as PricingResult | null,
    paymentTransactionId: params.paymentTransactionId,
    paymentAmountKzt: params.paymentAmountKzt,
    paymentStatus: params.paymentStatus,
    fiscalStatus: params.fiscalStatus,
    fiscalReceiptId: params.fiscalReceiptId,
    customerComment: params.customerComment,
  };

  const financeConfig = getFinanceConfig();
  if (!financeConfig.securityLevelId) {
    console.warn(`${tag} Finance report created WITHOUT Jira security level. Configure JIRA_FINANCE_SECURITY_LEVEL_ID before granting translators broad project access.`);
  }

  const payload = buildFinanceIssuePayload(reportParams);

  const res = await jiraFetch('/issue', { method: 'POST', body: JSON.stringify(payload) });
  if (!res) return null;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`${tag} Jira create finance issue failed: ${res.status} ${text.slice(0, 300)}`);
    await supabase.from('jobs').update({
      finance_jira_sync_status: 'failed',
      finance_jira_last_error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
    } as Record<string, unknown>).eq('id', params.jobId);
    return null;
  }

  const data = await res.json() as { id: string; key: string };
  const issueKey = data.key;
  const issueId = data.id;
  const auth = getJiraAuth()!;
  const issueUrl = `${auth.baseUrl}/browse/${issueKey}`;

  await supabase.from('jobs').update({
    finance_jira_issue_id: issueId,
    finance_jira_issue_key: issueKey,
    finance_jira_issue_url: issueUrl,
    finance_jira_sync_status: 'synced',
    finance_jira_synced_at: new Date().toISOString(),
  } as Record<string, unknown>).eq('id', params.jobId);

  // Link to main order issue (non-fatal on failure)
  try {
    await createJiraIssueLink(issueKey, params.mainIssueKey);
  } catch (err) {
    console.warn(`${tag} Failed to link finance issue (non-fatal):`, err instanceof Error ? err.message : String(err));
  }

  console.log(`${tag} ✓ Finance report Jira issue created: ${issueKey} → linked to ${params.mainIssueKey}`);
  return issueKey;
}

// ─── Price breakdown issue ────────────────────────────────────────────────────

/**
 * Load all price breakdown data for a job from the DB.
 * Source of truth: price_quotes → price_quote_items → cost_reservations.
 * Never uses pricing_context_json as primary source — that's a config snapshot, not line items.
 */
async function loadPriceBreakdownData(jobId: string, tag: string): Promise<{
  quote: DbPriceQuote | null;
  items: DbPriceQuoteItem[];
  reservations: DbCostReservation[];
  documentId: string | null;
  paymentTransactionId: string | null;
}> {
  // Load most recent price quote for this job
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: quoteRow } = await (supabase as any)
    .from('price_quotes')
    .select('id, document_id, amount_kzt, currency, status, source_language, target_language, language_pair, document_type, service_level, physical_page_count, included_page_count, included_word_count, source_word_count, urgency_level, sales_channel, fulfillment_method, pricing_version_id, pricing_context_json, internal_cost_json, margin_json, breakdown_json')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const quoteRowData = quoteRow as Record<string, unknown> | null;
  const quote = quoteRowData ? mapPriceQuote(quoteRowData) : null;
  const quoteId = quote?.id ?? null;
  const documentId = (quoteRowData?.document_id as string | null) ?? null;

  // Load price_quote_items (all items for operator view — not filtered by is_client_visible)
  let items: DbPriceQuoteItem[] = [];
  if (quoteId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: itemRows } = await (supabase as any)
      .from('price_quote_items')
      .select('id, item_type, label, quantity, unit_price_kzt, amount_kzt, is_client_visible, is_cost, sort_order, metadata_json')
      .eq('quote_id', quoteId)
      .order('sort_order', { ascending: true });
    items = ((itemRows as Record<string, unknown>[] | null) ?? []).map(mapPriceQuoteItem);
  }

  // Load cost_reservations
  let reservations: DbCostReservation[] = [];
  if (quoteId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: resRows } = await (supabase as any)
      .from('cost_reservations')
      .select('id, cost_type, amount_kzt, status, payable_to_type, payable_to_id, notes')
      .eq('quote_id', quoteId)
      .order('created_at', { ascending: true });
    reservations = ((resRows as Record<string, unknown>[] | null) ?? []).map(mapCostReservation);
  }

  // Load payment_transaction_id for context (most recent for this job)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: txRow } = await (supabase as any)
    .from('payment_transactions')
    .select('id')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const paymentTransactionId = (txRow as Record<string, unknown> | null)?.id as string | null ?? null;

  console.log(`${tag} data loaded — quote=${quoteId ?? 'null'} items=${items.length} reservations=${reservations.length} margin=${Object.keys(quote?.marginJson ?? {}).length > 0}`);

  return { quote, items, reservations, documentId, paymentTransactionId };
}

/**
 * Create a Price Breakdown Story in Jira for the given order.
 * Called immediately after the main Jira issue is created, at order initialisation time.
 * Loads price_quotes, price_quote_items, and cost_reservations from the DB directly.
 * Controlled by env var JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED=true.
 *
 * Always non-blocking — never throws to the caller; returns issue key or null.
 * Idempotent via jobs.price_jira_issue_key.
 */
export async function createPriceBreakdownIssue(params: {
  jobId: string;
  mainIssueKey: string;
  serviceLevel: string;
  sourceLanguage: string;
  targetLanguage: string;
  documentType: string;
  paymentSource: string | null;
}): Promise<string | null> {
  const tag = `[price-breakdown-jira:${params.jobId.slice(0, 8)}]`;
  const config = getPriceBreakdownConfig();

  if (!config.enabled) {
    console.log(`${tag} JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED not set — skipping`);
    return null;
  }

  if (!getJiraAuth()) {
    console.log(`${tag} Jira not configured — skipping price breakdown issue`);
    return null;
  }

  // Idempotency check
  const { data: existingJob } = await supabase
    .from('jobs')
    .select('price_jira_issue_key')
    .eq('id', params.jobId)
    .maybeSingle();

  const existingKey = (existingJob as Record<string, unknown> | null)?.price_jira_issue_key as string | null;
  if (existingKey) {
    console.log(`${tag} Price breakdown issue already exists: ${existingKey}`);
    return existingKey;
  }

  // Load all price data from DB (primary source of truth)
  const { quote, items, reservations, documentId, paymentTransactionId } =
    await loadPriceBreakdownData(params.jobId, tag);

  // Diagnostics
  const revenueItems = items.filter(i => !i.isCost);
  const costItems = items.filter(i => i.isCost);
  console.log(`${tag} quote.amount_kzt=${quote?.amountKzt ?? 'null'} revenue=${revenueItems.length} cost=${costItems.length} reservations=${reservations.length} description building...`);
  if (items.length === 0) {
    console.warn(`${tag} WARNING: price_quote_items is empty — description will show warning block`);
  }

  const fullParams: PriceBreakdownFullParams = {
    jobId: params.jobId,
    mainIssueKey: params.mainIssueKey,
    paymentTransactionId,
    paymentSource: params.paymentSource,
    documentId,
    serviceLevel: params.serviceLevel,
    sourceLanguage: params.sourceLanguage,
    targetLanguage: params.targetLanguage,
    documentType: params.documentType,
    quote,
    items,
    reservations,
  };

  const description = buildPriceBreakdownDescription(fullParams);
  console.log(`${tag} description built — ${JSON.stringify(description).length} chars`);

  const payload = buildPriceBreakdownPayload(fullParams);

  const res = await jiraFetch('/issue', { method: 'POST', body: JSON.stringify(payload) });
  if (!res) return null;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`${tag} Jira create price breakdown issue failed: ${res.status} ${text.slice(0, 300)}`);
    await supabase.from('jobs').update({
      price_jira_sync_status: 'failed',
      price_jira_last_error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
    } as Record<string, unknown>).eq('id', params.jobId);
    return null;
  }

  const data = await res.json() as { id: string; key: string };
  const issueKey = data.key;
  const issueId = data.id;
  const auth = getJiraAuth()!;
  const issueUrl = `${auth.baseUrl}/browse/${issueKey}`;

  await supabase.from('jobs').update({
    price_jira_issue_id: issueId,
    price_jira_issue_key: issueKey,
    price_jira_issue_url: issueUrl,
    price_jira_sync_status: 'synced',
    price_jira_synced_at: new Date().toISOString(),
  } as Record<string, unknown>).eq('id', params.jobId);

  // Link to main order issue (non-fatal on failure)
  try {
    await createJiraIssueLink(issueKey, params.mainIssueKey);
  } catch (err) {
    console.warn(`${tag} Failed to link price breakdown issue (non-fatal):`, err instanceof Error ? err.message : String(err));
  }

  console.log(`${tag} ✓ Price breakdown Jira issue created: ${issueKey} → linked to ${params.mainIssueKey}`);
  return issueKey;
}

// ─── Price breakdown reconciliation ─────────────────────────────────────────
// initializeOrderIntegrations() creates the price breakdown issue fire-and-forget
// (`void (async () => {...})()`), deliberately non-blocking so a slow/failed Jira
// call never delays OCR start. In a long-running worker process that's normally
// safe (unlike a serverless function, there's no "response returned, promise
// frozen" risk) — but if the process restarts or crashes while that promise is
// still in flight, the side effect is lost with nothing else ever retrying it.
// WO-75 incident, 2026-07-09: exactly this happened during the Drive OAuth
// incident response (worker was restarted while WO-75 was mid-pipeline) — the
// main Jira issue (WO-75) was created, but its price breakdown issue never was,
// and nothing noticed until an operator spotted it missing.
//
// This sweep finds jobs with a main Jira issue but no price breakdown issue yet
// and retries via the same idempotent createPriceBreakdownIssue() (its own
// jobs.price_jira_issue_key check prevents duplicates).

const PRICE_BREAKDOWN_RETRY_AFTER_MINUTES = 15;
// Configurable so ops can throttle the first run(s) after flipping
// JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED=true on an environment with an existing
// backlog of jobs missing their price breakdown issue (see the backlog audit
// script, scripts/prod/2026-07-09_audit-price-breakdown-backlog.ts) — e.g. set
// PRICE_BREAKDOWN_RECONCILE_BATCH_SIZE=1 on Railway to drain the backlog one
// job per 15-minute cycle instead of the default 10, then raise it back up.
function getPriceBreakdownMaxItemsPerCycle(): number {
  const raw = process.env.PRICE_BREAKDOWN_RECONCILE_BATCH_SIZE;
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10;
}

export async function reconcilePendingPriceBreakdownIssues(): Promise<void> {
  const config = getPriceBreakdownConfig();
  if (!config.enabled) return; // feature intentionally off — nothing to reconcile

  const cutoff = new Date(Date.now() - PRICE_BREAKDOWN_RETRY_AFTER_MINUTES * 60 * 1000).toISOString();
  const maxItemsPerCycle = getPriceBreakdownMaxItemsPerCycle();

  const { data: candidates, error } = await supabase
    .from('jobs')
    .select('id, document_id, service_level, payment_source, jira_issue_key, price_jira_issue_key, created_at')
    .not('jira_issue_key', 'is', null)
    .is('price_jira_issue_key', null)
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(maxItemsPerCycle);

  if (error) {
    console.error('[price-breakdown-reconcile] DB error fetching candidates:', error.message);
    return;
  }
  if (!candidates || candidates.length === 0) return;

  console.warn(`[price-breakdown-reconcile] ${candidates.length} job(s) missing a price breakdown issue — retrying`);

  for (const job of candidates as Array<{
    id: string; document_id: string; service_level: string | null;
    payment_source: 'card_payment' | 'subscription' | null; jira_issue_key: string;
  }>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: doc } = await (supabase as any)
      .from('documents')
      .select('source_language, target_language, document_type')
      .eq('id', job.document_id)
      .maybeSingle();

    if (!doc) {
      console.error(`[price-breakdown-reconcile] document not found for job ${job.id} — skipping`);
      continue;
    }

    try {
      const issueKey = await createPriceBreakdownIssue({
        jobId: job.id,
        mainIssueKey: job.jira_issue_key,
        serviceLevel: job.service_level ?? 'electronic',
        sourceLanguage: doc.source_language as string,
        targetLanguage: doc.target_language as string,
        documentType: doc.document_type as string,
        paymentSource: job.payment_source ?? null,
      });
      if (issueKey) {
        console.log(`[price-breakdown-reconcile] ✓ job ${job.id.slice(0, 8)} → ${issueKey}`);
      }
    } catch (err) {
      console.error(`[price-breakdown-reconcile] job ${job.id.slice(0, 8)} retry failed (non-fatal):`, err instanceof Error ? err.message : String(err));
    }
  }
}

/**
 * Update the description of an existing Jira price breakdown issue.
 * Used by the rebuild script to fix an already-created but empty issue.
 */
export async function updatePriceBreakdownIssueDescription(params: {
  jobId: string;
  issueKey: string;
  serviceLevel: string;
  sourceLanguage: string;
  targetLanguage: string;
  documentType: string;
  paymentSource: string | null;
}): Promise<boolean> {
  const tag = `[price-breakdown-rebuild:${params.jobId.slice(0, 8)}]`;

  if (!getJiraAuth()) {
    console.error(`${tag} Jira not configured`);
    return false;
  }

  const { quote, items, reservations, documentId, paymentTransactionId } =
    await loadPriceBreakdownData(params.jobId, tag);

  console.log(`${tag} items=${items.length} reservations=${reservations.length}`);

  const fullParams: PriceBreakdownFullParams = {
    jobId: params.jobId,
    mainIssueKey: params.issueKey, // used only in buildPriceBreakdownSummary inside payload
    paymentTransactionId,
    paymentSource: params.paymentSource,
    documentId,
    serviceLevel: params.serviceLevel,
    sourceLanguage: params.sourceLanguage,
    targetLanguage: params.targetLanguage,
    documentType: params.documentType,
    quote,
    items,
    reservations,
  };

  const description = buildPriceBreakdownDescription(fullParams);

  // PUT updates description only; Jira ignores unchanged fields
  const res = await jiraFetch(`/issue/${params.issueKey}`, {
    method: 'PUT',
    body: JSON.stringify({ fields: { description } }),
  });

  if (!res) return false;

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`${tag} Jira update description failed: ${res.status} ${text.slice(0, 300)}`);
    return false;
  }

  // 204 No Content on success
  console.log(`${tag} ✓ Jira issue ${params.issueKey} description updated`);
  return true;
}

// ─── Backfill: patch missing Drive/delivery fields onto an existing order issue ──
// initializeOrderIntegrations() only sets these fields once, at issue-create time —
// there is no other code path that goes back and patches them in later. This is
// what makes that gap possible (WO-75 incident, 2026-07-09): if driveUrl or the
// delivery fields weren't available yet when the issue was created, they're never
// retried. Used by the repair/backfill script — never overwrites a field that
// already has a value on the Jira issue.

export interface JiraOrderFieldsPatch {
  driveUrl?: string | null;
  deliveryPhone?: string | null;
  deliveryAddress?: string | null;
  fulfillmentMethod?: 'pickup' | 'delivery' | null;
}

/** Fetches only the fields we might backfill, to avoid clobbering existing values. */
async function getExistingJiraOrderFields(issueKey: string): Promise<Record<string, unknown> | null> {
  const fieldIds = [JIRA_FIELDS.documentsLink, JIRA_FIELDS.deliveryPhone, JIRA_FIELDS.deliveryAddress].join(',');
  const res = await jiraFetch(`/issue/${issueKey}?fields=${fieldIds}`);
  if (!res || !res.ok) return null;
  const data = (await res.json()) as { fields: Record<string, unknown> };
  return data.fields;
}

export async function backfillJiraOrderFields(
  issueKey: string,
  patch: JiraOrderFieldsPatch,
): Promise<{ ok: boolean; updatedFields: string[]; skippedFields: string[]; error?: string }> {
  const tag = `[jira-backfill:${issueKey}]`;

  if (!getJiraAuth()) {
    return { ok: false, updatedFields: [], skippedFields: [], error: 'Jira not configured' };
  }

  const existing = await getExistingJiraOrderFields(issueKey);
  if (existing === null) {
    return { ok: false, updatedFields: [], skippedFields: [], error: 'failed to read existing issue fields' };
  }

  const fields: Record<string, unknown> = {};
  const updatedFields: string[] = [];
  const skippedFields: string[] = [];

  const maybeSet = (fieldId: string, label: string, value: unknown): void => {
    if (value === null || value === undefined || value === '') return;
    const current = existing[fieldId];
    if (current !== null && current !== undefined && current !== '') {
      skippedFields.push(`${label} (already set)`);
      return;
    }
    fields[fieldId] = value;
    updatedFields.push(label);
  };

  maybeSet(JIRA_FIELDS.documentsLink, 'documentsLink', patch.driveUrl ?? null);
  if (patch.fulfillmentMethod === 'delivery') {
    maybeSet(JIRA_FIELDS.deliveryPhone, 'deliveryPhone', patch.deliveryPhone ?? null);
    maybeSet(JIRA_FIELDS.deliveryAddress, 'deliveryAddress', patch.deliveryAddress ?? null);
  }

  if (Object.keys(fields).length === 0) {
    console.log(`${tag} nothing to backfill (all target fields already set or no data available)`);
    return { ok: true, updatedFields: [], skippedFields };
  }

  const res = await jiraFetch(`/issue/${issueKey}`, {
    method: 'PUT',
    body: JSON.stringify({ fields }),
  });

  if (!res) return { ok: false, updatedFields: [], skippedFields, error: 'Jira not configured' };
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const error = `Jira update failed: ${res.status} ${text.slice(0, 300)}`;
    console.error(`${tag} ${error}`);
    return { ok: false, updatedFields: [], skippedFields, error };
  }

  console.log(`${tag} ✓ backfilled: ${updatedFields.join(', ')}`);
  return { ok: true, updatedFields, skippedFields };
}

// ─── Telegram helper ──────────────────────────────────────────────────────────

async function sendTelegram(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    if (!res.ok) console.error(`[worker-telegram] sendMessage failed: ${res.status}`);
  } catch (e) {
    console.error('[worker-telegram] sendMessage threw:', e instanceof Error ? e.message : e);
  }
}

// ─── Supabase update helpers ───────────────────────────────────────────────────

async function updateJobIntegration(jobId: string, fields: Record<string, unknown>): Promise<void> {
  const { error } = await supabase
    .from('jobs')
    .update({ ...fields, last_synced_at: new Date().toISOString() })
    .eq('id', jobId);
  if (error) console.error('[worker-integration] job update failed:', error.message);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface InitResult {
  jiraIssueKey: string | null;
  jiraIssueUrl: string | null;
  driveFolderId: string | null;
  driveUrl: string | null;
  /** ID of the 02_AI_DRAFT subfolder for later upload */
  aiDraftFolderId: string | null;
  /** ID of the 01_SOURCE subfolder */
  sourceFolderId: string | null;
}

/**
 * Initialize Drive folder + Jira issue for a certified/notarized order.
 * Called by the worker BEFORE OCR to ensure integrations are set up.
 * Idempotent: if folder/issue already exist in DB, skips creation.
 */
export async function initializeOrderIntegrations(params: {
  jobId: string;
  serviceLevel: ServiceLevel;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  notaryCity?: string | null;
  fulfillmentMethod?: 'pickup' | 'delivery' | null;
  deliveryPhone?: string | null;
  deliveryAddress?: string | null;
  paymentSource?: 'card_payment' | 'subscription' | null;
  /** Supabase user ID (documents.user_id) — stored in Jira customfield_10074 */
  customerId?: string | null;
  /** R2 key of the source PDF — uploaded to Drive 01_SOURCE if provided */
  sourceFileKey?: string | null;
  /** Optional order comment from the customer — included in Jira description */
  customerComment?: string | null;
}): Promise<InitResult> {
  const tag = `[worker-integration:${params.jobId.slice(0, 8)}]`;
  console.log(`${tag} initializeOrderIntegrations — ${params.serviceLevel}`);

  // Check if already initialized (idempotency guard)
  const { data: existing } = await supabase
    .from('jobs')
    .select('jira_issue_key, jira_issue_url, google_drive_folder_id, google_drive_folder_url')
    .eq('id', params.jobId)
    .single();

  // For electronic orders, Jira is never created — idempotency only requires Drive folder.
  const driveReady = !!existing?.google_drive_folder_id;
  const jiraReady = params.serviceLevel === 'electronic' || !!existing?.jira_issue_key;
  if (driveReady && jiraReady) {
    console.log(`${tag} already initialized — jira=${existing?.jira_issue_key ?? 'n/a'} drive=${existing!.google_drive_folder_id}`);
    const aiDraftFolderId = await getSubfolderId(existing!.google_drive_folder_id!, DRIVE_SUBFOLDER_NAMES.aiDraft).catch(() => null);
    const sourceFolderId = await getSubfolderId(existing!.google_drive_folder_id!, DRIVE_SUBFOLDER_NAMES.source).catch(() => null);
    return {
      jiraIssueKey: existing?.jira_issue_key ?? null,
      jiraIssueUrl: existing?.jira_issue_url ?? null,
      driveFolderId: existing!.google_drive_folder_id!,
      driveUrl: existing?.google_drive_folder_url ?? null,
      aiDraftFolderId,
      sourceFolderId,
    };
  }

  let driveFolderId: string | null = existing?.google_drive_folder_id ?? null;
  let driveUrl: string | null = existing?.google_drive_folder_url ?? null;
  let aiDraftFolderId: string | null = null;
  let sourceFolderId: string | null = null;
  let jiraIssueKey: string | null = existing?.jira_issue_key ?? null;
  let jiraIssueUrl: string | null = existing?.jira_issue_url ?? null;

  // ── 1. Create Drive folder ─────────────────────────────────────────────────
  if (!driveFolderId && isDriveConfigured()) {
    try {
      const folder = await createOrderFolder(params.jobId);
      driveFolderId = folder.folderId;
      driveUrl = folder.folderUrl;
      aiDraftFolderId = folder.subfolders.aiDraft;
      sourceFolderId = folder.subfolders.source;

      await updateJobIntegration(params.jobId, {
        google_drive_folder_id: driveFolderId,
        google_drive_folder_url: driveUrl,
        drive_sync_status: 'created',
      });
      console.log(`${tag} ✓ Drive folder created: ${driveUrl}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${tag} Drive folder creation failed: ${msg}`);
      await updateJobIntegration(params.jobId, { drive_sync_status: 'error', last_integration_error: msg });
      const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID ?? process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
      if (chatId) await sendTelegram(chatId, `⚠️ Drive folder creation failed\nJob: ${params.jobId.slice(0, 8)}\n${msg}`).catch(() => undefined);
    }
  } else if (!driveFolderId) {
    // Drive env vars not set — record the misconfiguration so the operator can see it
    const msg = 'Google Drive not configured — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_DRIVE_ROOT_FOLDER_ID on Railway';
    console.error(`${tag} ${msg}`);
    await updateJobIntegration(params.jobId, { drive_sync_status: 'error', last_integration_error: msg });
    const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID ?? process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
    if (chatId) await sendTelegram(chatId, `⚠️ ${msg}\nJob: ${params.jobId.slice(0, 8)}`).catch(() => undefined);
  } else {
    aiDraftFolderId = await getSubfolderId(driveFolderId, DRIVE_SUBFOLDER_NAMES.aiDraft).catch(() => null);
    sourceFolderId = await getSubfolderId(driveFolderId, DRIVE_SUBFOLDER_NAMES.source).catch(() => null);
  }

  // ── 2. Upload source PDF to Drive 01_SOURCE ────────────────────────────────
  if (sourceFolderId && params.sourceFileKey) {
    try {
      const pdfBuf = await downloadFile(params.sourceFileKey);
      await uploadFileToDrive(sourceFolderId, 'source.pdf', pdfBuf, 'application/pdf');
      console.log(`${tag} ✓ source.pdf uploaded to Drive 01_SOURCE`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${tag} source Drive upload failed (non-fatal): ${msg}`);
    }
  }

  // ── 3. Create Jira issue (certified/notarized only — electronic is fully automated) ───────
  if (!jiraIssueKey && params.serviceLevel !== 'electronic') {
    if (!getJiraAuth()) {
      // Credentials missing — record the misconfiguration so the operator can see it in Supabase
      const msg = 'Jira credentials not configured — set JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN on Railway';
      console.error(`${tag} ${msg}`);
      await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
      const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID ?? process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
      if (chatId) await sendTelegram(chatId, `⚠️ ${msg}\nJob: ${params.jobId.slice(0, 8)}`).catch(() => undefined);
    } else {
      try {
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? 'https://wpotranslations.org';
        const issue = await createJiraIssue({
          jobId: params.jobId,
          customerId: params.customerId ?? null,
          serviceLevel: params.serviceLevel,
          sourceLang: params.sourceLang,
          targetLang: params.targetLang,
          documentType: params.documentType,
          notaryCity: params.notaryCity,
          fulfillmentMethod: params.fulfillmentMethod ?? null,
          deliveryPhone: params.deliveryPhone ?? null,
          deliveryAddress: params.deliveryAddress ?? null,
          paymentSource: params.paymentSource ?? null,
          driveUrl,
          wpoUrl: `${siteUrl}/dashboard`,
          createdAt: new Date().toISOString(),
          customerComment: params.customerComment ?? null,
        });

        if (issue) {
          jiraIssueKey = issue.issueKey;
          jiraIssueUrl = issue.issueUrl;
          await updateJobIntegration(params.jobId, {
            jira_issue_id: issue.issueId,
            jira_issue_key: issue.issueKey,
            jira_issue_url: issue.issueUrl,
            jira_sync_status: 'created',
          });
          console.log(`${tag} ✓ Jira issue created: ${issue.issueKey}`);

          // Create price breakdown issue immediately after main issue (non-blocking).
          // loadPriceBreakdownData inside createPriceBreakdownIssue fetches all data from DB.
          void (async () => {
            try {
              await createPriceBreakdownIssue({
                jobId: params.jobId,
                mainIssueKey: issue.issueKey,
                serviceLevel: params.serviceLevel,
                sourceLanguage: params.sourceLang,
                targetLanguage: params.targetLang,
                documentType: params.documentType,
                paymentSource: params.paymentSource ?? null,
              });
            } catch (pbErr) {
              console.error(`${tag} createPriceBreakdownIssue failed (non-fatal):`, pbErr instanceof Error ? pbErr.message : String(pbErr));
            }
          })();

          const auth = getJiraAuth();
          const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID ?? process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
          if (chatId) {
            await sendTelegram(
              chatId,
              [
                `📋 <b>New Order</b> — ${serviceLevelLabel(params.serviceLevel)}`,
                `Job: <code>${params.jobId.slice(0, 8)}</code>`,
                `${params.sourceLang.toUpperCase()} → ${params.targetLang.toUpperCase()} | ${params.documentType.split('|')[0]}`,
                issue.issueKey && auth ? `Jira: <a href="${auth.baseUrl}/browse/${issue.issueKey}">${issue.issueKey}</a>` : null,
                driveUrl ? `Drive: ${driveUrl}` : null,
              ].filter(Boolean).join('\n'),
            ).catch(() => undefined);
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${tag} Jira issue creation failed: ${msg}`);
        await updateJobIntegration(params.jobId, { jira_sync_status: 'error', last_integration_error: msg });
        const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID ?? process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
        if (chatId) await sendTelegram(chatId, `⚠️ Jira issue creation failed\nJob: ${params.jobId.slice(0, 8)}\n${msg}`).catch(() => undefined);
      }
    }
  }

  return { jiraIssueKey, jiraIssueUrl, driveFolderId, driveUrl, aiDraftFolderId, sourceFolderId };
}

/**
 * After AI draft is generated: upload to Drive 02_AI_DRAFT.
 * Jira Automation handles all subsequent Jira-side steps (assign, transition, notify).
 */
export async function triggerTranslatorReview(params: {
  jobId: string;
  jiraIssueKey?: string | null;
  serviceLevel: ServiceLevel;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  driveUrl?: string | null;
  driveFolderId?: string | null;
  /** Direct ID of the 02_AI_DRAFT subfolder — avoids a search query if known */
  aiDraftFolderId?: string | null;
  /** R2 key of the AI draft DOCX artifact */
  draftFileKey?: string | null;
  draftFileName?: string | null;
}): Promise<void> {
  const tag = `[worker-integration:${params.jobId.slice(0, 8)}]`;

  // ── 1. Upload AI draft DOCX to Drive 02_AI_DRAFT ─────────────────────────
  // Preview PDF is not generated for official AI drafts — only ai_draft.docx.
  if (params.driveFolderId && isDriveConfigured()) {
    // Use the folder ID passed directly from initializeOrderIntegrations if available.
    // Fall back to a search only if needed (e.g. when called after a worker restart).
    let aiDraftFolderId: string | null = params.aiDraftFolderId ?? null;
    if (!aiDraftFolderId) {
      try {
        aiDraftFolderId = await getSubfolderId(params.driveFolderId, DRIVE_SUBFOLDER_NAMES.aiDraft);
        if (!aiDraftFolderId) {
          console.error(`${tag} 02_AI_DRAFT subfolder not found in Drive folder ${params.driveFolderId}`);
        }
      } catch (err) {
        console.error(`${tag} could not resolve 02_AI_DRAFT subfolder (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (aiDraftFolderId && params.draftFileKey) {
      try {
        const buf = await downloadFile(params.draftFileKey);
        const name = params.draftFileName ?? 'ai_draft.docx';
        const mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        await uploadFileToDrive(aiDraftFolderId, name, buf, mime);
        console.log(`${tag} ✓ ai_draft.docx uploaded to Drive 02_AI_DRAFT`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`${tag} DOCX Drive upload failed (non-fatal): ${msg}`);
      }
    } else if (!aiDraftFolderId) {
      console.error(`${tag} ai_draft upload skipped — 02_AI_DRAFT folder ID not available`);
    } else if (!params.draftFileKey) {
      console.error(`${tag} ai_draft upload skipped — draftFileKey is null`);
    }
  }

  // ── 2. Update Supabase + notify translator ────────────────────────────────
  await updateJobIntegration(params.jobId, {
    jira_sync_status: 'translator_review',
  });

  const chatId = process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
  if (chatId) {
    const auth = getJiraAuth();
    const jiraLink =
      params.jiraIssueKey && auth
        ? `\nJira: <a href="${auth.baseUrl}/browse/${params.jiraIssueKey}">${params.jiraIssueKey}</a>`
        : '';
    await sendTelegram(
      chatId,
      [
        `📋 <b>New Translation Assignment</b>`,
        `Job: <code>${params.jobId.slice(0, 8)}</code>`,
        `${params.sourceLang.toUpperCase()} → ${params.targetLang.toUpperCase()} | ${params.documentType.split('|')[0]}`,
        jiraLink || null,
        params.driveUrl ? `Drive: ${params.driveUrl}` : null,
      ].filter(Boolean).join('\n'),
    ).catch(() => undefined);
  }

  console.log(`${tag} ✓ translator review triggered — Jira Automation handles assignment`);
}
