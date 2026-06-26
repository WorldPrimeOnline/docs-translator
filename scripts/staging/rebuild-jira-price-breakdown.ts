#!/usr/bin/env npx tsx
/**
 * Rebuild the Jira Price Breakdown issue for an existing order.
 *
 * Behaviour:
 *   1. Load DB state (jobs.price_jira_issue_key, jobs.jira_issue_key).
 *   2. If DB has a price_jira_issue_key → that is the canonical issue.
 *   3. If not in DB but mainIssueKey is known → search Jira by summary + label.
 *   4. If Jira search finds exactly one → adopt it, update DB record, then update description.
 *   5. If Jira search finds multiple → log warning, use oldest/first as canonical, update it.
 *   6. If nothing found → create new issue and link to main order issue.
 *   7. Idempotent: never creates a duplicate when an existing issue can be found.
 *
 * SAFETY:
 *   - Reads data only; creates/updates one Jira issue; no payment logic touched.
 *   - --dry-run prints the diagnostics and description without writing anything.
 *   - --dedupe prints all existing price breakdown issues but does not delete them.
 *   - Production code never deletes issues.
 *
 * Usage:
 *   npx tsx scripts/staging/rebuild-jira-price-breakdown.ts --quote-id <uuid>
 *   npx tsx scripts/staging/rebuild-jira-price-breakdown.ts --job-id <uuid>
 *   npx tsx scripts/staging/rebuild-jira-price-breakdown.ts --quote-id <uuid> --main-issue-key WO-123
 *   npx tsx scripts/staging/rebuild-jira-price-breakdown.ts --quote-id <uuid> --dry-run
 *   npx tsx scripts/staging/rebuild-jira-price-breakdown.ts --quote-id <uuid> --dedupe
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   JIRA_BASE_URL
 *   JIRA_EMAIL
 *   JIRA_API_TOKEN
 *   JIRA_PRICE_BREAKDOWN_ISSUE_ENABLED=true
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// ─── Env loading ──────────────────────────────────────────────────────────────
const ROOT = path.resolve(process.cwd());

function loadEnvFile(filename: string): boolean {
  const filepath = path.join(ROOT, filename);
  if (fs.existsSync(filepath)) {
    dotenv.config({ path: filepath });
    return true;
  }
  return false;
}

const stagingLoaded = loadEnvFile('.env.staging.local');
const localLoaded   = loadEnvFile('.env.local');

console.log('\n[rebuild-price-breakdown] Env files:',
  [stagingLoaded && '.env.staging.local', localLoaded && '.env.local'].filter(Boolean).join(', ') || '(none)',
);

// ─── CLI arg parsing ──────────────────────────────────────────────────────────

interface CliArgs {
  quoteId: string | null;
  jobId: string | null;
  mainIssueKey: string | null;
  dryRun: boolean;
  dedupe: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let quoteId: string | null = null;
  let jobId: string | null = null;
  let mainIssueKey: string | null = null;
  let dryRun = false;
  let dedupe = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--quote-id' && args[i + 1]) quoteId = args[++i];
    if (args[i] === '--job-id' && args[i + 1]) jobId = args[++i];
    if (args[i] === '--main-issue-key' && args[i + 1]) mainIssueKey = args[++i];
    if (args[i] === '--dry-run') dryRun = true;
    if (args[i] === '--dedupe') dedupe = true;
  }

  return { quoteId, jobId, mainIssueKey, dryRun, dedupe };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Jira search types ────────────────────────────────────────────────────────

interface JiraIssueRef {
  id: string;
  key: string;
  fields: { summary: string; created: string };
}

interface JiraSearchResult {
  total: number;
  issues: JiraIssueRef[];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const {
    mapPriceQuote,
    mapPriceQuoteItem,
    mapCostReservation,
    buildPriceBreakdownDescription,
    getPriceBreakdownConfig,
    buildPriceBreakdownSummary,
  } = await import('../../worker/src/lib/jira/price-breakdown');

  const { createClient } = await import('@supabase/supabase-js');

  const { quoteId: rawQuoteId, jobId: rawJobId, mainIssueKey: cliMainIssueKey, dryRun, dedupe } = parseArgs();

  if (!rawQuoteId && !rawJobId) {
    console.error('Error: --quote-id or --job-id is required');
    console.error('Usage: npx tsx scripts/staging/rebuild-jira-price-breakdown.ts --quote-id <uuid>');
    process.exit(1);
  }

  const argId = rawQuoteId ?? rawJobId!;
  if (!UUID_RE.test(argId)) {
    console.error(`Error: invalid UUID format: "${argId}"`);
    process.exit(1);
  }

  if (dryRun) console.log('\n[rebuild-price-breakdown] DRY RUN — no writes will be performed\n');
  if (dedupe) console.log('[rebuild-price-breakdown] DEDUPE mode — will report duplicate issues\n');

  // ── Supabase client ────────────────────────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    process.exit(1);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(supabaseUrl, serviceKey) as any;

  // ── Jira auth ──────────────────────────────────────────────────────────────
  const jiraBaseUrl = process.env.JIRA_BASE_URL?.replace(/\/$/, '');
  const jiraEmail   = process.env.JIRA_EMAIL;
  const jiraToken   = process.env.JIRA_API_TOKEN;
  if (!jiraBaseUrl || !jiraEmail || !jiraToken) {
    console.error('Error: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN must be set');
    process.exit(1);
  }
  const authHeader = 'Basic ' + Buffer.from(`${jiraEmail}:${jiraToken}`).toString('base64');

  async function jiraFetch(urlPath: string, options: RequestInit = {}): Promise<Response> {
    return fetch(`${jiraBaseUrl}/rest/api/3${urlPath}`, {
      ...options,
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers as Record<string, string> ?? {}),
      },
    });
  }

  const config = getPriceBreakdownConfig();

  // ── Resolve quote_id from job_id if needed ─────────────────────────────────
  let quoteId = rawQuoteId;
  let resolvedJobId = rawJobId;

  if (!quoteId && resolvedJobId) {
    const { data } = await db
      .from('price_quotes')
      .select('id, job_id')
      .eq('job_id', resolvedJobId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) {
      console.error(`No price_quote found for job_id=${resolvedJobId}`);
      process.exit(1);
    }
    quoteId = data.id as string;
    console.log(`Resolved quote_id=${quoteId} from job_id=${resolvedJobId}`);
  }

  // ── Load price_quote ───────────────────────────────────────────────────────
  const { data: quoteRow } = await db
    .from('price_quotes')
    .select('id, job_id, document_id, amount_kzt, currency, status, source_language, target_language, language_pair, document_type, service_level, physical_page_count, included_page_count, included_word_count, source_word_count, urgency_level, sales_channel, fulfillment_method, pricing_version_id, pricing_context_json, internal_cost_json, margin_json, breakdown_json')
    .eq('id', quoteId)
    .maybeSingle();

  if (!quoteRow) {
    console.error(`price_quote not found: id=${quoteId}`);
    process.exit(1);
  }

  const quote = mapPriceQuote(quoteRow as Record<string, unknown>);
  resolvedJobId = resolvedJobId ?? (quoteRow.job_id as string | null);
  const documentId = (quoteRow.document_id as string | null) ?? null;

  console.log(`\n[rebuild-price-breakdown] Quote: ${quote.id}`);
  console.log(`  amount_kzt   : ${quote.amountKzt}`);
  console.log(`  status       : ${quote.status}`);
  console.log(`  language_pair: ${quote.languagePair ?? `${quote.sourceLanguage} → ${quote.targetLanguage}`}`);
  console.log(`  job_id       : ${resolvedJobId ?? '—'}`);

  // ── Load price_quote_items ─────────────────────────────────────────────────
  const { data: itemRows } = await db
    .from('price_quote_items')
    .select('id, item_type, label, quantity, unit_price_kzt, amount_kzt, is_client_visible, is_cost, sort_order, metadata_json')
    .eq('quote_id', quoteId)
    .order('sort_order', { ascending: true });

  const items = ((itemRows as Record<string, unknown>[] | null) ?? []).map(mapPriceQuoteItem);
  console.log(`  price_quote_items: ${items.length} rows`);
  if (items.length === 0) {
    console.warn('  WARNING: price_quote_items is empty — description will show warning block');
  }

  // ── Load cost_reservations ─────────────────────────────────────────────────
  const { data: resRows } = await db
    .from('cost_reservations')
    .select('id, cost_type, amount_kzt, status, payable_to_type, payable_to_id, notes')
    .eq('quote_id', quoteId)
    .order('created_at', { ascending: true });

  const reservations = ((resRows as Record<string, unknown>[] | null) ?? []).map(mapCostReservation);
  console.log(`  cost_reservations: ${reservations.length} rows`);

  // ── Load payment_transaction_id ────────────────────────────────────────────
  let paymentTransactionId: string | null = null;
  if (resolvedJobId) {
    const { data: txRow } = await db
      .from('payment_transactions')
      .select('id')
      .eq('job_id', resolvedJobId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    paymentTransactionId = (txRow as Record<string, unknown> | null)?.id as string | null ?? null;
  }

  // ── Load job data (existing price issue key + main issue key) ──────────────
  let dbPriceIssueKey: string | null = null;
  let dbMainIssueKey: string | null = null;
  let paymentSource: string | null = null;

  if (resolvedJobId) {
    const { data: jobRow } = await db
      .from('jobs')
      .select('price_jira_issue_key, jira_issue_key, payment_source')
      .eq('id', resolvedJobId)
      .maybeSingle();

    if (jobRow) {
      dbPriceIssueKey = (jobRow.price_jira_issue_key as string | null) ?? null;
      dbMainIssueKey  = (jobRow.jira_issue_key as string | null) ?? null;
      paymentSource   = (jobRow.payment_source as string | null) ?? null;
    }
  }

  // CLI --main-issue-key overrides DB value
  const mainIssueKey: string | null = cliMainIssueKey ?? dbMainIssueKey;

  console.log(`  price_jira_issue_key (DB) : ${dbPriceIssueKey ?? '(none)'}`);
  console.log(`  jira_issue_key (main, DB) : ${dbMainIssueKey ?? '(none)'}`);
  if (cliMainIssueKey) console.log(`  --main-issue-key (CLI)    : ${cliMainIssueKey}`);
  console.log(`  mainIssueKey (resolved)   : ${mainIssueKey ?? '(none — UNKNOWN will be used in description)'}`);

  if (!mainIssueKey) {
    console.warn('\n  WARNING: main Jira issue key not found in DB and not provided via --main-issue-key.');
    console.warn('  The description will show "UNKNOWN" for the main order issue reference.');
    console.warn('  Pass --main-issue-key WO-123 to set it correctly.\n');
  }

  // ── Search Jira for existing price breakdown issues ────────────────────────
  // Used when DB record has no price_jira_issue_key (e.g. column added after job creation).
  let jiraFoundIssues: JiraIssueRef[] = [];

  if (!dbPriceIssueKey && mainIssueKey) {
    const expectedSummary = buildPriceBreakdownSummary(mainIssueKey);
    const jql = `project = "${config.projectKey}" AND labels = "wpo-price-breakdown" AND summary = "${expectedSummary.replace(/"/g, '\\"')}"`;
    console.log(`\n  Jira search (no DB key): ${jql}`);

    try {
      const searchRes = await jiraFetch(
        `/search?jql=${encodeURIComponent(jql)}&fields=summary,created&maxResults=20`,
      );
      if (searchRes.ok) {
        const searchData = await searchRes.json() as JiraSearchResult;
        jiraFoundIssues = searchData.issues ?? [];
        console.log(`  Found ${jiraFoundIssues.length} matching Jira issue(s)`);
      } else {
        console.warn(`  Jira search failed: ${searchRes.status} — will proceed without Jira search results`);
      }
    } catch (e) {
      console.warn('  Jira search threw:', e instanceof Error ? e.message : String(e));
    }
  } else if (!dbPriceIssueKey && !mainIssueKey) {
    // Search by label only — broader but still useful for dedupe
    const jql = `project = "${config.projectKey}" AND labels = "wpo-price-breakdown" ORDER BY created ASC`;
    console.log(`\n  Jira search (no main key, label only): ${jql}`);
    try {
      const searchRes = await jiraFetch(
        `/search?jql=${encodeURIComponent(jql)}&fields=summary,created&maxResults=50`,
      );
      if (searchRes.ok) {
        const searchData = await searchRes.json() as JiraSearchResult;
        jiraFoundIssues = searchData.issues ?? [];
        console.log(`  Found ${jiraFoundIssues.length} wpo-price-breakdown issues total (label-only search)`);
      }
    } catch (e) {
      console.warn('  Jira search threw:', e instanceof Error ? e.message : String(e));
    }
  }

  // ── Resolve canonical price issue key ─────────────────────────────────────
  let canonicalPriceIssueKey: string | null = dbPriceIssueKey;
  let canonicalPriceIssueId: string | null = null;
  let duplicateKeys: string[] = [];

  if (!canonicalPriceIssueKey && jiraFoundIssues.length > 0) {
    // Sort by created ascending — oldest is canonical
    const sorted = [...jiraFoundIssues].sort((a, b) =>
      new Date(a.fields.created).getTime() - new Date(b.fields.created).getTime(),
    );
    canonicalPriceIssueKey = sorted[0].key;
    canonicalPriceIssueId  = sorted[0].id;
    duplicateKeys = sorted.slice(1).map(i => i.key);

    if (duplicateKeys.length > 0) {
      console.warn(`\n  WARNING: ${duplicateKeys.length} duplicate price breakdown issue(s) found:`);
      duplicateKeys.forEach(k => console.warn(`    - ${k}`));
      console.warn(`  Canonical (oldest): ${canonicalPriceIssueKey}`);
      console.warn('  Duplicates will NOT be deleted. Remove them manually in Jira if needed.\n');
    } else {
      console.log(`  Jira search found existing issue: ${canonicalPriceIssueKey} (adopting)`);
    }
  }

  // ── Build description ──────────────────────────────────────────────────────
  const fullParams = {
    jobId: resolvedJobId ?? '(unknown)',
    mainIssueKey: mainIssueKey ?? 'UNKNOWN',
    paymentTransactionId,
    paymentSource,
    documentId,
    serviceLevel: quote.serviceLevel ?? 'unknown',
    sourceLanguage: quote.sourceLanguage ?? 'unknown',
    targetLanguage: quote.targetLanguage ?? 'unknown',
    documentType: quote.documentType ?? 'unknown',
    quote,
    items,
    reservations,
  };

  const description = buildPriceBreakdownDescription(fullParams);

  // ── Diagnostics ────────────────────────────────────────────────────────────
  console.log('\n──────────────────────────────────────────');
  console.log('[rebuild-price-breakdown] Diagnostics:');
  console.log(`  quoteId                        : ${quoteId}`);
  console.log(`  resolvedJobId                  : ${resolvedJobId ?? '—'}`);
  console.log(`  mainIssueKey                   : ${mainIssueKey ?? 'UNKNOWN'}`);
  console.log(`  dbPriceIssueKey                : ${dbPriceIssueKey ?? '(none)'}`);
  console.log(`  jiraFoundCount                 : ${jiraFoundIssues.length}`);
  console.log(`  canonicalPriceIssueKey         : ${canonicalPriceIssueKey ?? '(none — will create)'}`);
  console.log(`  duplicateCount                 : ${duplicateKeys.length}`);
  if (duplicateKeys.length > 0) console.log(`  duplicateKeys                  : ${duplicateKeys.join(', ')}`);
  console.log(`  willCreate                     : ${!canonicalPriceIssueKey}`);
  console.log(`  willUpdate                     : ${!!canonicalPriceIssueKey}`);
  console.log(`  willLink                       : ${!canonicalPriceIssueKey && !!mainIssueKey}`);
  console.log(`  descriptionFormat              : ADF`);
  console.log(`  descriptionChars               : ${JSON.stringify(description).length}`);
  console.log(`  revenue items                  : ${items.filter(i => !i.isCost).length}`);
  console.log(`  cost items                     : ${items.filter(i => i.isCost).length}`);
  console.log(`  reservations                   : ${reservations.length}`);
  const margin = quote.marginJson as { estimatedMarginKzt?: number; estimatedMarginRate?: number };
  if (margin.estimatedMarginKzt != null) {
    console.log(`  margin                         : ${margin.estimatedMarginKzt.toFixed(2)} KZT (${((margin.estimatedMarginRate ?? 0) * 100).toFixed(2)}%)`);
  }
  console.log('──────────────────────────────────────────\n');

  if (dryRun) {
    console.log('[rebuild-price-breakdown] DRY RUN — stopping here. No Jira writes performed.\n');
    return;
  }

  // ── Update existing issue ──────────────────────────────────────────────────
  if (canonicalPriceIssueKey) {
    console.log(`[rebuild-price-breakdown] Updating existing issue ${canonicalPriceIssueKey}...`);
    const res = await jiraFetch(`/issue/${canonicalPriceIssueKey}`, {
      method: 'PUT',
      body: JSON.stringify({ fields: { description } }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`Jira PUT failed: ${res.status} ${text.slice(0, 300)}`);
      process.exit(1);
    }

    console.log(`✓ Issue ${canonicalPriceIssueKey} description updated`);
    console.log(`  View: ${jiraBaseUrl}/browse/${canonicalPriceIssueKey}`);

    // Sync DB if we adopted a Jira issue that wasn't in DB
    if (!dbPriceIssueKey && canonicalPriceIssueId && resolvedJobId) {
      const issueUrl = `${jiraBaseUrl}/browse/${canonicalPriceIssueKey}`;
      await db.from('jobs').update({
        price_jira_issue_id: canonicalPriceIssueId,
        price_jira_issue_key: canonicalPriceIssueKey,
        price_jira_issue_url: issueUrl,
        price_jira_sync_status: 'synced',
        price_jira_synced_at: new Date().toISOString(),
      } as Record<string, unknown>).eq('id', resolvedJobId);
      console.log('  jobs.price_jira_issue_key synced to DB (adopted from Jira search)');
    }

    // Ensure it is linked to the main order issue
    if (mainIssueKey) {
      const linkRes = await jiraFetch('/issueLink', {
        method: 'POST',
        body: JSON.stringify({
          type: { name: 'Relates' },
          inwardIssue: { key: canonicalPriceIssueKey },
          outwardIssue: { key: mainIssueKey },
        }),
      });
      if (linkRes.ok) {
        console.log(`  Link to ${mainIssueKey}: ensured`);
      } else {
        const status = linkRes.status;
        // 404 on the link type name or 400 for "already linked" — both are non-fatal
        console.warn(`  Link to ${mainIssueKey} returned ${status} (may already be linked or link type not found — non-fatal)`);
      }
    } else {
      console.warn('  Main Jira issue key not found; price issue was not linked');
    }

    if (dedupe && duplicateKeys.length > 0) {
      console.log('\n[rebuild-price-breakdown] DEDUPE report:');
      console.log(`  Canonical issue : ${canonicalPriceIssueKey}`);
      console.log(`  Duplicates (${duplicateKeys.length}):`);
      duplicateKeys.forEach(k => console.log(`    ${jiraBaseUrl}/browse/${k}`));
      console.log('  Action required: manually close or delete duplicates in Jira.');
    }

  } else {
    // ── Create new issue ─────────────────────────────────────────────────────
    console.log('[rebuild-price-breakdown] No existing price breakdown issue found — creating new one...');

    const summary = mainIssueKey
      ? buildPriceBreakdownSummary(mainIssueKey)
      : `Price Breakdown for ${resolvedJobId?.slice(0, 8) ?? quoteId?.slice(0, 8) ?? 'unknown'}`;

    const payload = {
      fields: {
        project: { key: config.projectKey },
        summary,
        issuetype: { name: config.issueType },
        labels: config.labels,
        description,
      },
    };

    const res = await jiraFetch('/issue', { method: 'POST', body: JSON.stringify(payload) });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`Jira POST failed: ${res.status} ${text.slice(0, 300)}`);
      process.exit(1);
    }

    const data = await res.json() as { id: string; key: string };
    const newKey = data.key;
    const newId  = data.id;
    const newUrl = `${jiraBaseUrl}/browse/${newKey}`;

    console.log(`✓ New Jira issue created: ${newKey}`);
    console.log(`  View: ${newUrl}`);

    // Link to main issue
    if (mainIssueKey) {
      const linkRes = await jiraFetch('/issueLink', {
        method: 'POST',
        body: JSON.stringify({
          type: { name: 'Relates' },
          inwardIssue: { key: newKey },
          outwardIssue: { key: mainIssueKey },
        }),
      });
      if (linkRes.ok) {
        console.log(`  Linked to ${mainIssueKey}`);
      } else {
        console.warn(`  Link to ${mainIssueKey} failed (non-fatal): ${linkRes.status}`);
      }
    } else {
      console.warn('  Main Jira issue key not found; price issue was not linked');
    }

    // Persist to DB
    if (resolvedJobId) {
      await db.from('jobs').update({
        price_jira_issue_id: newId,
        price_jira_issue_key: newKey,
        price_jira_issue_url: newUrl,
        price_jira_sync_status: 'synced',
        price_jira_synced_at: new Date().toISOString(),
      } as Record<string, unknown>).eq('id', resolvedJobId);
      console.log('  jobs.price_jira_issue_key updated in DB');
    }
  }

  console.log('\n[rebuild-price-breakdown] Done.\n');
}

main().catch((err) => {
  console.error('[rebuild-price-breakdown] Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
