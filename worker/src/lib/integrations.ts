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
import { buildJiraIssueFields, JIRA_FIELDS, buildApplicantTypeDescriptionLine, buildNotaryUrgencyDescriptionLines } from './jira/order-fields';
import { resolveNotaryUrgencySnapshot, type ResolvedNotaryUrgencySnapshot, type JobUrgencyColumns } from './notary-urgency';
import { searchJiraIssuesByJql } from './jira/search';
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

/**
 * Retry wrapper for Jira write calls (createIssue). Retries on network failure
 * (jiraFetch returning null) or a 5xx response; a 4xx is a validation/permission
 * problem that a retry cannot fix, so it is returned immediately for the caller
 * to turn into a thrown error.
 */
async function jiraFetchWithRetry(path: string, options: RequestInit, maxRetries = 3): Promise<Response | null> {
  let lastErr = 'unknown error';
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await jiraFetch(path, options);
    if (res && (res.ok || res.status < 500)) return res;
    lastErr = res ? `HTTP ${res.status}` : 'network error (no response)';
    if (attempt < maxRetries) {
      const backoffMs = 500 * 2 ** (attempt - 1);
      console.warn(`[worker-jira] ${path} attempt ${attempt}/${maxRetries} failed (${lastErr}) — retrying in ${backoffMs}ms`);
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  console.error(`[worker-jira] ${path} failed after ${maxRetries} attempts: ${lastErr}`);
  return null;
}

/** Adapter for searchJiraIssuesByJql(), which expects a throwing fetch (it wraps the call in its own try/catch). */
async function jiraFetchThrowing(path: string, options?: RequestInit): Promise<Response> {
  const res = await jiraFetch(path, options);
  if (!res) throw new Error('Jira fetch failed (network error or Jira not configured)');
  return res;
}

function serviceLevelLabel(level: ServiceLevel): string {
  if (level === 'notarization_through_partners') return 'notarized';
  if (level === 'official_with_translator_signature_and_provider_stamp') return 'certified';
  return 'electronic';
}

/**
 * Best-effort lookup of the referring partner's Application ID for a job.
 * Returns null (never throws) if the order has no referral, the partner_referrals
 * row hasn't landed yet (attachReferralToOrder is fire-and-forget on the web side),
 * or the partner record has no application_id on file.
 */
export async function getPartnerApplicationId(jobId: string): Promise<string | null> {
  try {
    const { data: referral } = await supabase
      .from('partner_referrals')
      .select('partner_id')
      .eq('job_id', jobId)
      .maybeSingle();
    if (!referral?.partner_id) return null;

    const { data: partner } = await supabase
      .from('partners')
      .select('application_id')
      .eq('id', referral.partner_id)
      .maybeSingle();
    return partner?.application_id ?? null;
  } catch (err) {
    console.error(`[worker-jira] getPartnerApplicationId failed for job ${jobId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── Notary urgency snapshot resolution ──────────────────────────────────────
// Pure resolution logic lives in ./notary-urgency (shared with jira/price-breakdown.ts
// without a circular import). This wrapper adds the DB lookup.

/**
 * DB-querying wrapper around resolveNotaryUrgencySnapshot() for a single job —
 * mirrors getPartnerApplicationId()'s pattern of resolving its own data rather
 * than requiring every caller to thread jobs-row fields through params.
 * Non-fatal: any query error is logged and treated as "no snapshot available",
 * never as a reason to fail issue creation.
 */
async function resolveNotaryUrgencySnapshotForJob(
  jobId: string,
  serviceLevel: string,
): Promise<ResolvedNotaryUrgencySnapshot | null> {
  if (serviceLevel !== 'notarization_through_partners') return null;

  try {
    const { data: job } = await supabase
      .from('jobs')
      .select('notary_urgency_level, notary_urgency_window, notary_urgency_multiplier, notary_urgency_cutoff_at, notary_urgency_fee_kzt')
      .eq('id', jobId)
      .maybeSingle();

    const jobRow = job as JobUrgencyColumns | null;
    if (jobRow?.notary_urgency_level != null) {
      return resolveNotaryUrgencySnapshot(jobRow, null);
    }

    // Legacy fallback — no jobs-row snapshot, try the quote's immutable pricing_context_json.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: quoteRow } = await (supabase as any)
      .from('price_quotes')
      .select('pricing_context_json, breakdown_json')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!quoteRow) return null;
    return resolveNotaryUrgencySnapshot(null, {
      pricingContextJson: (quoteRow.pricing_context_json as Record<string, unknown>) ?? {},
      breakdownJson: (quoteRow.breakdown_json as Record<string, unknown>) ?? {},
    });
  } catch (err) {
    console.error(`[worker-jira] resolveNotaryUrgencySnapshotForJob failed for job ${jobId}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

async function createJiraIssue(params: {
  jobId: string;
  customerId: string | null;
  serviceLevel: ServiceLevel;
  sourceLang: string;
  targetLang: string;
  documentType: string;
  notaryCity?: string | null;
  applicantType?: 'individual' | 'legal_entity' | 'unknown' | null;
  fulfillmentMethod?: 'pickup' | 'delivery' | null;
  deliveryPhone?: string | null;
  deliveryAddress?: string | null;
  paymentSource?: 'card_payment' | 'subscription' | null;
  driveUrl?: string | null;
  wpoUrl: string;
  createdAt?: string;
  customerComment?: string | null;
  /** partner_applications.id (UUID) of the referring partner — omitted when the order has no referral. */
  partnerApplicationId?: string | null;
  /** Resolved via resolveNotaryUrgencySnapshot() — jobs columns preferred, quote JSON fallback for legacy jobs. */
  notaryUrgencySnapshot?: ResolvedNotaryUrgencySnapshot | null;
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
    buildApplicantTypeDescriptionLine(params.serviceLevel, params.applicantType),
    ...buildNotaryUrgencyDescriptionLines(params.serviceLevel, params.notaryUrgencySnapshot),
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
    partnerApplicationId: params.partnerApplicationId ?? null,
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

  const res = await jiraFetchWithRetry('/issue', { method: 'POST', body: JSON.stringify(body) });
  if (!res) {
    // Previously returned null here, which callers treated the same as "Jira
    // not configured" and silently skipped — a genuine network failure left
    // jobs.jira_sync_status untouched (never 'error'), so a paid order could
    // end up with no Jira issue and no operator-visible signal at all.
    // Throwing routes network failures through the same catch/alert path as
    // HTTP errors below.
    throw new Error('Jira createIssue failed: no response after retries (network error)');
  }

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
    .select('id, document_id, amount_kzt, currency, status, source_language, target_language, language_pair, document_type, service_level, physical_page_count, included_page_count, included_word_count, source_word_count, urgency_level, sales_channel, fulfillment_method, pricing_version_id, pricing_context_json, internal_cost_json, margin_json, breakdown_json, wpo_financial_breakdown_json, source_character_count_with_spaces')
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

    // Jira-side idempotency search before creating — createPriceBreakdownIssue()
    // itself only checks jobs.price_jira_issue_key in Postgres, so a Story that
    // was created in Jira but whose DB write was lost (e.g. worker restart
    // mid-flight) would otherwise get duplicated by this reconciler. Mirrors
    // the same hard-stop-on-failed-search safety contract already used by
    // scripts/staging/rebuild-jira-price-breakdown.ts.
    const expectedSummary = buildPriceBreakdownSummary(job.jira_issue_key);
    const label = config.labels[0] ?? 'wpo-price-breakdown';
    const jql = `project = "${config.projectKey}" AND labels = "${label}" AND summary = "${expectedSummary.replace(/"/g, '\\"')}"`;
    const searchResult = await searchJiraIssuesByJql(jiraFetchThrowing, jql, ['summary', 'created'], 5);

    if (!searchResult.ok) {
      console.error(`[price-breakdown-reconcile] job ${job.id.slice(0, 8)} Jira idempotency search failed — skipping this cycle (never falls through to create): ${searchResult.error}`);
      continue;
    }

    if (searchResult.issues.length > 0) {
      const sorted = [...searchResult.issues].sort(
        (a, b) => new Date(a.fields.created).getTime() - new Date(b.fields.created).getTime(),
      );
      const found = sorted[0];
      const auth = getJiraAuth();
      await updateJobIntegration(job.id, {
        price_jira_issue_id: found.id,
        price_jira_issue_key: found.key,
        price_jira_issue_url: auth ? `${auth.baseUrl}/browse/${found.key}` : null,
        price_jira_sync_status: 'recovered',
      });
      console.log(`[price-breakdown-reconcile] ✓ job ${job.id.slice(0, 8)} — found existing Story ${found.key} in Jira, adopted instead of creating${sorted.length > 1 ? ` (${sorted.length - 1} other match(es) found — review manually)` : ''}`);
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
  /** partner_applications.id (UUID) — same value/source as initializeOrderIntegrations' create-time lookup. */
  partnerApplicationId?: string | null;
}

/** Fetches only the fields we might backfill, to avoid clobbering existing values. */
async function getExistingJiraOrderFields(issueKey: string): Promise<Record<string, unknown> | null> {
  const fieldIds = [JIRA_FIELDS.documentsLink, JIRA_FIELDS.deliveryPhone, JIRA_FIELDS.deliveryAddress, JIRA_FIELDS.partnerApplicationId].join(',');
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
  maybeSet(JIRA_FIELDS.partnerApplicationId, 'partnerApplicationId', patch.partnerApplicationId ?? null);

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

/**
 * Append-only audit trail for Jira sync events. Worker integration failures
 * previously left no trace in job_audit_log at all — only a jobs.last_integration_error
 * string that gets overwritten by the next attempt. Best-effort: never throws.
 */
async function writeIntegrationAuditLog(jobId: string, action: string, metadata: Record<string, unknown>): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('job_audit_log').insert({
      job_id: jobId,
      actor: 'system',
      source: 'worker',
      action,
      jira_issue_key: (metadata.jiraIssueKey as string | undefined) ?? null,
      metadata,
    });
  } catch (err) {
    console.error('[worker-integration] job_audit_log insert failed (non-fatal):', err instanceof Error ? err.message : String(err));
  }
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
  applicantType?: 'individual' | 'legal_entity' | 'unknown' | null;
  fulfillmentMethod?: 'pickup' | 'delivery' | null;
  deliveryPhone?: string | null;
  deliveryAddress?: string | null;
  paymentSource?: 'card_payment' | 'subscription' | null;
  /** Supabase user ID (documents.user_id) — stored in Jira customfield_10074 */
  customerId?: string | null;
  /** R2 key of the source PDF — uploaded to Drive 01_SOURCE if provided */
  sourceFileKey?: string | null;
  /**
   * Multi-source jobs (job_source_files rows exist, 2026-08-01 decision) upload each
   * REAL original source to 01_SOURCE themselves, with NNN-prefixed naming — set this
   * to skip this function's single hardcoded source.pdf upload (which would otherwise
   * upload the internal merged pricing/analysis bundle under a misleading name).
   */
  skipMergedSourceUpload?: boolean;
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
  if (sourceFolderId && params.sourceFileKey && !params.skipMergedSourceUpload) {
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
        const partnerApplicationId = await getPartnerApplicationId(params.jobId);
        const notaryUrgencySnapshot = await resolveNotaryUrgencySnapshotForJob(params.jobId, params.serviceLevel);
        const issue = await createJiraIssue({
          jobId: params.jobId,
          customerId: params.customerId ?? null,
          serviceLevel: params.serviceLevel,
          sourceLang: params.sourceLang,
          targetLang: params.targetLang,
          documentType: params.documentType,
          notaryCity: params.notaryCity,
          applicantType: params.applicantType ?? null,
          fulfillmentMethod: params.fulfillmentMethod ?? null,
          deliveryPhone: params.deliveryPhone ?? null,
          deliveryAddress: params.deliveryAddress ?? null,
          paymentSource: params.paymentSource ?? null,
          driveUrl,
          wpoUrl: `${siteUrl}/dashboard`,
          createdAt: new Date().toISOString(),
          customerComment: params.customerComment ?? null,
          partnerApplicationId,
          notaryUrgencySnapshot,
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
          await writeIntegrationAuditLog(params.jobId, 'jira_issue_created', {
            jiraIssueKey: issue.issueKey,
            serviceLevel: params.serviceLevel,
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
        await writeIntegrationAuditLog(params.jobId, 'jira_sync_error', { error: msg, serviceLevel: params.serviceLevel });
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

// ─── Recovery: ensure a paid, non-electronic order has its main Jira issue ────

export interface EnsureJiraResult {
  jobId: string;
  dryRun: boolean;
  outcome:
    | 'already_linked'
    | 'skipped_electronic'
    | 'skipped_not_paid'
    | 'would_adopt_existing'
    | 'adopted_existing'
    | 'would_create'
    | 'created'
    | 'error';
  jiraIssueKey: string | null;
  jiraIssueUrl: string | null;
  detail: string;
}

/**
 * Idempotent recovery for a single order missing its main Jira issue.
 *
 * Never touches payment_transactions, price_quotes, or documents — only
 * jobs.jira_* fields and job_audit_log. Safe to call repeatedly:
 *   1. jobs.jira_issue_key already set        -> no-op
 *   2. service_level === 'electronic'         -> no-op (electronic orders never get a Jira issue by design)
 *   3. no paid payment_transactions row        -> refuses to create anything for an unpaid order
 *   4. Jira search by summary=jobId finds one -> adopts it (link restored, no new issue)
 *   5. Jira search finds none                  -> creates exactly once
 *
 * A failed Jira search is a hard stop (mirrors scripts/staging/rebuild-jira-price-breakdown.ts) —
 * never falls through to "create" when the search itself could not complete, since that
 * risks a duplicate issue for an order that already has one Jira couldn't find right now.
 */
export async function ensureJiraIssueForPaidOrder(jobId: string, dryRun = false): Promise<EnsureJiraResult> {
  const tag = `[ensure-jira:${jobId.slice(0, 8)}]${dryRun ? ' [dry-run]' : ''}`;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: job, error: jobErr } = await (supabase as any)
    .from('jobs')
    .select('id, service_level, payment_source, jira_issue_key, jira_issue_url, notary_city, applicant_type, fulfillment_method, delivery_phone, delivery_address, customer_comment, document_id, google_drive_folder_url')
    .eq('id', jobId)
    .single();

  if (jobErr || !job) {
    return { jobId, dryRun, outcome: 'error', jiraIssueKey: null, jiraIssueUrl: null, detail: `job not found: ${jobErr?.message ?? jobId}` };
  }

  if (job.jira_issue_key) {
    return { jobId, dryRun, outcome: 'already_linked', jiraIssueKey: job.jira_issue_key, jiraIssueUrl: job.jira_issue_url ?? null, detail: 'jobs.jira_issue_key already set — nothing to do' };
  }

  const serviceLevel = (job.service_level ?? 'electronic') as ServiceLevel;
  if (serviceLevel === 'electronic') {
    return { jobId, dryRun, outcome: 'skipped_electronic', jiraIssueKey: null, jiraIssueUrl: null, detail: 'electronic orders never get a Jira issue by design — this is expected, not an incident' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: payment } = await (supabase as any)
    .from('payment_transactions')
    .select('status')
    .eq('job_id', jobId)
    .in('status', ['paid', 'completed'])
    .maybeSingle();

  const isSubscription = job.payment_source === 'subscription';
  if (!payment && !isSubscription) {
    return { jobId, dryRun, outcome: 'skipped_not_paid', jiraIssueKey: null, jiraIssueUrl: null, detail: 'no paid payment_transactions row and payment_source is not subscription — refusing to create a Jira issue for an unpaid order' };
  }

  if (!getJiraAuth()) {
    return { jobId, dryRun, outcome: 'error', jiraIssueKey: null, jiraIssueUrl: null, detail: 'Jira credentials not configured (JIRA_BASE_URL/JIRA_EMAIL/JIRA_API_TOKEN)' };
  }

  const projectKey = process.env.JIRA_PROJECT_KEY ?? 'WO';
  const jql = `project = "${projectKey}" AND summary = "${jobId}"`;
  const searchResult = await searchJiraIssuesByJql(jiraFetchThrowing, jql, ['summary', 'created'], 5);

  if (!searchResult.ok) {
    return { jobId, dryRun, outcome: 'error', jiraIssueKey: null, jiraIssueUrl: null, detail: `Jira idempotency search failed — refusing to create: ${searchResult.error}` };
  }

  if (searchResult.issues.length > 0) {
    const sorted = [...searchResult.issues].sort(
      (a, b) => new Date(a.fields.created).getTime() - new Date(b.fields.created).getTime(),
    );
    const found = sorted[0];
    const auth = getJiraAuth()!;
    const issueUrl = `${auth.baseUrl}/browse/${found.key}`;
    const dupeNote = sorted.length > 1 ? ` (${sorted.length - 1} other matching issue(s) found — review manually for duplicates)` : '';

    if (dryRun) {
      console.log(`${tag} would adopt existing Jira issue ${found.key}${dupeNote}`);
      return { jobId, dryRun, outcome: 'would_adopt_existing', jiraIssueKey: found.key, jiraIssueUrl: issueUrl, detail: `found an existing, unlinked Jira issue${dupeNote}` };
    }

    await updateJobIntegration(jobId, {
      jira_issue_id: found.id,
      jira_issue_key: found.key,
      jira_issue_url: issueUrl,
      jira_sync_status: 'recovered',
    });
    await writeIntegrationAuditLog(jobId, 'jira_issue_recovered', { jiraIssueKey: found.key, duplicatesFound: sorted.length - 1 });
    console.log(`${tag} ✓ adopted existing Jira issue ${found.key}${dupeNote}`);
    return { jobId, dryRun, outcome: 'adopted_existing', jiraIssueKey: found.key, jiraIssueUrl: issueUrl, detail: `linked to a pre-existing Jira issue that was never written back to the job${dupeNote}` };
  }

  // Nothing in Jira — create exactly once.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: doc } = await (supabase as any)
    .from('documents')
    .select('user_id, source_language, target_language, document_type')
    .eq('id', job.document_id)
    .maybeSingle();

  if (dryRun) {
    console.log(`${tag} would create a new Jira issue (service_level=${serviceLevel})`);
    return { jobId, dryRun, outcome: 'would_create', jiraIssueKey: null, jiraIssueUrl: null, detail: 'no existing issue found in Jira — a real run would create exactly one' };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.SITE_URL ?? 'https://wpotranslations.org';
  const partnerApplicationId = await getPartnerApplicationId(jobId);
  const notaryUrgencySnapshot = await resolveNotaryUrgencySnapshotForJob(jobId, serviceLevel);

  try {
    const issue = await createJiraIssue({
      jobId,
      customerId: doc?.user_id ?? null,
      serviceLevel,
      sourceLang: doc?.source_language ?? 'unknown',
      targetLang: doc?.target_language ?? 'unknown',
      documentType: doc?.document_type ?? 'unknown',
      notaryCity: job.notary_city ?? null,
      applicantType: job.applicant_type ?? null,
      fulfillmentMethod: job.fulfillment_method ?? null,
      deliveryPhone: job.delivery_phone ?? null,
      deliveryAddress: job.delivery_address ?? null,
      paymentSource: job.payment_source ?? null,
      driveUrl: job.google_drive_folder_url ?? null,
      notaryUrgencySnapshot,
      wpoUrl: `${siteUrl}/dashboard`,
      createdAt: new Date().toISOString(),
      customerComment: job.customer_comment ?? null,
      partnerApplicationId,
    });

    if (!issue) {
      return { jobId, dryRun, outcome: 'error', jiraIssueKey: null, jiraIssueUrl: null, detail: 'Jira returned no issue (unexpected — auth check passed earlier)' };
    }

    await updateJobIntegration(jobId, {
      jira_issue_id: issue.issueId,
      jira_issue_key: issue.issueKey,
      jira_issue_url: issue.issueUrl,
      jira_sync_status: 'recovered',
    });
    await writeIntegrationAuditLog(jobId, 'jira_issue_recovered', { jiraIssueKey: issue.issueKey, source: 'recovery-create' });
    console.log(`${tag} ✓ created Jira issue ${issue.issueKey}`);
    return { jobId, dryRun, outcome: 'created', jiraIssueKey: issue.issueKey, jiraIssueUrl: issue.issueUrl, detail: 'no existing issue found in Jira — created a new one' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateJobIntegration(jobId, { jira_sync_status: 'error', last_integration_error: msg });
    await writeIntegrationAuditLog(jobId, 'jira_sync_error', { error: msg, source: 'recovery-create' });
    console.error(`${tag} Jira issue creation failed: ${msg}`);
    return { jobId, dryRun, outcome: 'error', jiraIssueKey: null, jiraIssueUrl: null, detail: `Jira issue creation failed: ${msg}` };
  }
}

const MISSING_JIRA_RETRY_AFTER_MINUTES = 20;

function getMissingJiraMaxItemsPerCycle(): number {
  const raw = process.env.MISSING_JIRA_RECONCILE_BATCH_SIZE;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 10;
}

/**
 * Periodic sweep for `status = paid AND service_level IN (certified, notarized)
 * AND jira_issue_key IS NULL` — the reconciliation the incident on 2026-07-15
 * showed was missing. Runs from worker/src/index.ts on the same interval
 * pattern as reconcilePendingPriceBreakdownIssues(). Electronic orders are
 * excluded — they never get a Jira issue by design, so they are not candidates.
 * The 20-minute age cutoff avoids racing initializeOrderIntegrations() on a
 * job that just started processing.
 */
export async function reconcileMissingJiraIssues(): Promise<void> {
  const cutoff = new Date(Date.now() - MISSING_JIRA_RETRY_AFTER_MINUTES * 60 * 1000).toISOString();
  const maxItemsPerCycle = getMissingJiraMaxItemsPerCycle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: candidates, error } = await (supabase as any)
    .from('jobs')
    .select('id, service_level, created_at')
    .is('jira_issue_key', null)
    .in('service_level', ['notarization_through_partners', 'official_with_translator_signature_and_provider_stamp'])
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(maxItemsPerCycle);

  if (error) {
    console.error('[jira-reconcile] DB error fetching candidates:', error.message);
    return;
  }
  if (!candidates || candidates.length === 0) return;

  console.warn(`[jira-reconcile] ${candidates.length} job(s) missing a main Jira issue — checking`);

  for (const job of candidates as Array<{ id: string }>) {
    try {
      const result = await ensureJiraIssueForPaidOrder(job.id, false);
      if (result.outcome === 'created' || result.outcome === 'adopted_existing') {
        console.log(`[jira-reconcile] ✓ job ${job.id.slice(0, 8)} → ${result.outcome} (${result.jiraIssueKey})`);
        const chatId = process.env.TELEGRAM_OPERATOR_CHAT_ID ?? process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
        if (chatId) {
          await sendTelegram(
            chatId,
            `🔧 Jira issue auto-recovered for job ${job.id.slice(0, 8)}: ${result.outcome} → ${result.jiraIssueKey}`,
          ).catch(() => undefined);
        }
      } else if (result.outcome === 'error') {
        console.error(`[jira-reconcile] job ${job.id.slice(0, 8)} still failing: ${result.detail}`);
      }
      // skipped_not_paid / skipped_electronic: expected states, nothing to alert on.
    } catch (err) {
      console.error(`[jira-reconcile] job ${job.id.slice(0, 8)} unexpected error (non-fatal):`, err instanceof Error ? err.message : String(err));
    }
  }
}

// ─── Reconcile: paid, referred orders missing Partner ID in Jira ─────────────

const PARTNER_ID_RECONCILE_LOOKBACK_DAYS = 30;

function getPartnerIdReconcileMaxItemsPerCycle(): number {
  const raw = process.env.PARTNER_ID_RECONCILE_BATCH_SIZE;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n > 0 ? n : 10;
}

/**
 * Periodic sweep for orders whose main Jira issue exists but customfield_10121
 * (Partner ID) may still be empty — the 2026-07-15 WO-77/WO-78 incident class:
 * a referral existed and partners.application_id was on file well before the
 * issue was created, but the field never made it in (root cause unconfirmed;
 * DB and code both say it should have worked — see docs/ai-context/DECISIONS.md
 * for the investigation).
 *
 * Unlike reconcileMissingJiraIssues()/reconcilePendingPriceBreakdownIssues(),
 * there is no DB column mirroring "has customfield_10121 been set in Jira" —
 * jobs.jira_sync_status is reused for workflow-stage mirroring by
 * src/lib/integrations/workflow.ts (syncTranslatorDoneNotarized et al.), so it
 * is not a reliable signal here. This sweep therefore re-checks the same
 * candidate population (paid-eligible, referred, has a main issue, created
 * within the lookback window) every cycle rather than shrinking via a DB flag.
 * That is intentionally safe, not wasteful-and-risky: backfillJiraOrderFields()
 * reads the live Jira value before writing and no-ops when already set, so an
 * already-correct job costs one extra Jira GET per cycle, never a duplicate or
 * incorrect write. getPartnerApplicationId() cheaply skips non-referred jobs
 * (a single null-checked DB lookup) before any Jira call is made.
 */
export async function reconcileMissingPartnerIds(): Promise<void> {
  const cutoff = new Date(Date.now() - PARTNER_ID_RECONCILE_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const maxItemsPerCycle = getPartnerIdReconcileMaxItemsPerCycle();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: candidates, error } = await (supabase as any)
    .from('jobs')
    .select('id, jira_issue_key, service_level, created_at')
    .not('jira_issue_key', 'is', null)
    .in('service_level', ['notarization_through_partners', 'official_with_translator_signature_and_provider_stamp'])
    .gt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(maxItemsPerCycle);

  if (error) {
    console.error('[partner-id-reconcile] DB error fetching candidates:', error.message);
    return;
  }
  if (!candidates || candidates.length === 0) return;

  for (const job of candidates as Array<{ id: string; jira_issue_key: string }>) {
    try {
      const partnerApplicationId = await getPartnerApplicationId(job.id);
      if (!partnerApplicationId) continue; // no referral, or partner has no application_id — not this sweep's concern

      const patchResult = await backfillJiraOrderFields(job.jira_issue_key, { partnerApplicationId });
      if (!patchResult.ok) {
        console.error(`[partner-id-reconcile] job ${job.id.slice(0, 8)} backfill check failed (non-fatal): ${patchResult.error}`);
        continue;
      }
      if (patchResult.updatedFields.includes('partnerApplicationId')) {
        console.log(`[partner-id-reconcile] ✓ job ${job.id.slice(0, 8)} → backfilled customfield_10121`);
        await writeIntegrationAuditLog(job.id, 'partner_id_backfilled', {
          jiraIssueKey: job.jira_issue_key,
          partnerApplicationId,
        });
      }
      // Already set: patchResult.skippedFields includes it — silent, no need
      // to log every already-correct job every cycle.
    } catch (err) {
      console.error(`[partner-id-reconcile] job ${job.id.slice(0, 8)} unexpected error (non-fatal):`, err instanceof Error ? err.message : String(err));
    }
  }
}
