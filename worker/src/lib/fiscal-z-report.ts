/**
 * Z-report (shift close) scheduler for Webkassa.
 *
 * Runs daily at WEBKASSA_Z_REPORT_HOUR (default 23:00) in WEBKASSA_Z_REPORT_TIMEZONE
 * (default Asia/Almaty).
 *
 * Idempotency: one Z-report per cashbox per business_date (UNIQUE constraint in DB).
 * If Z-report for today already exists with status 'issued' or 'already_closed', skip.
 *
 * Guard: Z-report only runs when there are no pending/retry_required fiscal receipts
 * for the same cashbox. This prevents closing the shift mid-batch.
 *
 * Sequential: Z-report goes through the same in-process cashbox queue as sale/refund
 * receipts — it waits for any in-flight receipt processing to complete.
 */

import { supabase } from './supabase';
import { env } from './env';
import {
  createZReport,
  sanitizeForStorage,
  WebkassaApiError,
  WebkassaNetworkError,
  type WebkassaConfig,
  type WebkassaZReportData,
} from './webkassa-client';

// ─── Config ───────────────────────────────────────────────────────────────────

function getWebkassaConfig(): WebkassaConfig | null {
  if (env.WEBKASSA_Z_REPORT_ENABLED !== 'true') return null;
  if (env.WEBKASSA_ENABLED !== 'true') return null;
  if (!env.WEBKASSA_API_KEY || !env.WEBKASSA_LOGIN || !env.WEBKASSA_PASSWORD || !env.WEBKASSA_CASHBOX_SERIAL_NUMBER) return null;
  if (env.FISCAL_PROVIDER_ENV === 'production' && env.WEBKASSA_ALLOW_REAL_RECEIPTS !== 'true') return null;

  return {
    apiBaseUrl: (env.WEBKASSA_API_BASE_URL
      ?? (env.FISCAL_PROVIDER_ENV === 'production'
        ? 'https://kkm.webkassa.kz'
        : 'https://devkkm.webkassa.kz')
    ).replace(/\/$/, ''),
    apiKey: env.WEBKASSA_API_KEY,
    login: env.WEBKASSA_LOGIN,
    password: env.WEBKASSA_PASSWORD,
    cashboxUniqueNumber: env.WEBKASSA_CASHBOX_SERIAL_NUMBER,
    timeoutMs: 30_000,
  };
}

// ─── Business date ────────────────────────────────────────────────────────────

function getBusinessDate(timezone: string): string {
  // Returns YYYY-MM-DD in the configured timezone
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function getCurrentHour(timezone: string): number {
  return parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hour12: false }).format(new Date()),
    10,
  );
}

// ─── Z-report DB record ───────────────────────────────────────────────────────

async function ensureZReportRow(cashboxId: string, businessDate: string): Promise<string | null> {
  // Check for existing row
  const { data: existing } = await (supabase as unknown as {
    from: (t: string) => {
      select: (cols: string) => {
        eq: (col: string, val: string) => {
          eq: (col: string, val: string) => {
            maybeSingle: () => Promise<{ data: { id: string; status: string } | null }>
          }
        }
      }
    }
  })
    .from('fiscal_z_reports')
    .select('id, status')
    .eq('cashbox_id', cashboxId)
    .eq('business_date', businessDate)
    .maybeSingle();

  if (existing) {
    if (['issued', 'already_closed'].includes(existing.status)) {
      console.info('[fiscal-z-report] Z-report already done for today', { businessDate, status: existing.status });
      return null; // already done
    }
    return existing.id; // retry failed/pending row
  }

  // Insert new pending row
  const { data: row, error } = await (supabase as unknown as {
    from: (t: string) => {
      insert: (row: unknown) => {
        select: (cols: string) => {
          single: () => Promise<{ data: { id: string } | null; error: { message: string; code: string } | null }>
        }
      }
    }
  })
    .from('fiscal_z_reports')
    .insert({
      cashbox_id: cashboxId,
      business_date: businessDate,
      status: 'pending',
    })
    .select('id')
    .single();

  if (error) {
    // Unique constraint: another worker already created the row
    if (error.code === '23505') {
      console.info('[fiscal-z-report] Z-report row created by another worker — skipping');
      return null;
    }
    console.error('[fiscal-z-report] failed to create Z-report row:', error.message);
    return null;
  }

  return row?.id ?? null;
}

async function updateZReportRow(
  rowId: string,
  result: { status: string; shiftNumber?: number; documentCount?: number; rawData: WebkassaZReportData | null; errorCode?: string; errorMessage?: string },
): Promise<void> {
  await (supabase as unknown as {
    from: (t: string) => {
      update: (row: unknown) => { eq: (col: string, val: string) => Promise<unknown> }
    }
  })
    .from('fiscal_z_reports')
    .update({
      status: result.status,
      shift_number: result.shiftNumber ?? null,
      document_count: result.documentCount ?? null,
      provider_response_sanitized: sanitizeForStorage(result.rawData),
      error_code: result.errorCode ?? null,
      error_message: result.errorMessage ?? null,
      issued_at: ['issued', 'already_closed'].includes(result.status) ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rowId);
}

// ─── Pending fiscal receipts guard ────────────────────────────────────────────

async function hasPendingFiscalReceipts(cashboxId: string): Promise<boolean> {
  // We filter by the configured cashbox — if multiple cashboxes are added later,
  // the provider_cashbox_id column should be used. For now WPO has one cashbox.
  const { count, error } = await (supabase as unknown as {
    from: (t: string) => {
      select: (cols: string, opts: unknown) => {
        in: (col: string, vals: string[]) => {
          limit: (n: number) => Promise<{ count: number | null; error: { message: string } | null }>
        }
      }
    }
  })
    .from('fiscal_receipts')
    .select('id', { count: 'exact', head: true })
    .in('status', ['pending', 'retry_required'])
    .limit(1);

  if (error) {
    console.warn('[fiscal-z-report] could not check pending receipts:', error.message);
    return true; // err on the side of caution: don't Z-report if we can't confirm
  }

  void cashboxId; // cashbox filtering via provider_cashbox_id would go here
  return (count ?? 0) > 0;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Run Z-report if:
 * 1. WEBKASSA_Z_REPORT_ENABLED=true
 * 2. Current hour (in WEBKASSA_Z_REPORT_TIMEZONE) >= WEBKASSA_Z_REPORT_HOUR
 * 3. No Z-report issued for today's business_date yet
 * 4. No pending fiscal receipts for this cashbox
 *
 * Z-report goes through the cashbox queue in fiscal-processor (caller responsibility).
 * This function is called from fiscal-reconciliation.ts after processPendingFiscalReceipts().
 */
export async function maybeRunScheduledZReport(): Promise<void> {
  const cfg = getWebkassaConfig();
  if (!cfg) return;

  const timezone = env.WEBKASSA_Z_REPORT_TIMEZONE;
  const targetHour = env.WEBKASSA_Z_REPORT_HOUR;
  const currentHour = getCurrentHour(timezone);

  if (currentHour < targetHour) return; // too early

  const businessDate = getBusinessDate(timezone);
  const cashboxId = cfg.cashboxUniqueNumber;

  const rowId = await ensureZReportRow(cashboxId, businessDate);
  if (rowId === null) return; // already done or collision

  // Guard: don't Z-report while receipts are still pending
  if (await hasPendingFiscalReceipts(cashboxId)) {
    console.info('[fiscal-z-report] skipping Z-report — pending fiscal receipts exist for cashbox', {
      cashboxId,
      businessDate,
    });
    // Leave row in 'pending' — will retry on next cycle
    return;
  }

  console.info('[fiscal-z-report] running Z-report', { cashboxId, businessDate });

  try {
    const result = await createZReport(cfg);

    await updateZReportRow(rowId, {
      status: result.alreadyClosed ? 'already_closed' : 'issued',
      shiftNumber: result.shiftNumber,
      documentCount: result.documentCount,
      rawData: result.rawData,
    });

    console.info('[fiscal-z-report] Z-report complete', {
      cashboxId,
      businessDate,
      alreadyClosed: result.alreadyClosed,
      shiftNumber: result.shiftNumber,
    });
  } catch (err) {
    const msg = (err as Error).message;
    const code = err instanceof WebkassaApiError ? String(err.code) : undefined;

    console.error('[fiscal-z-report] Z-report failed', { cashboxId, businessDate, errorCode: code });

    await updateZReportRow(rowId, {
      status: 'failed',
      errorCode: code,
      errorMessage: msg,
      rawData: null,
    });
  }
}

// ─── Direct execution (for testing / manual trigger) ─────────────────────────

/**
 * Force-run Z-report for today regardless of the scheduled hour check.
 * Used by test scripts and manual operator triggers.
 */
export async function forceRunZReport(): Promise<void> {
  const cfg = getWebkassaConfig();
  if (!cfg) {
    console.warn('[fiscal-z-report] force run: Webkassa Z-report not configured or disabled');
    return;
  }

  const timezone = env.WEBKASSA_Z_REPORT_TIMEZONE;
  const businessDate = getBusinessDate(timezone);
  const cashboxId = cfg.cashboxUniqueNumber;

  const rowId = await ensureZReportRow(cashboxId, businessDate);
  if (rowId === null) {
    console.info('[fiscal-z-report] force run: already done for today', { businessDate });
    return;
  }

  console.info('[fiscal-z-report] force run Z-report', { cashboxId, businessDate });

  try {
    const result = await createZReport(cfg);
    await updateZReportRow(rowId, {
      status: result.alreadyClosed ? 'already_closed' : 'issued',
      shiftNumber: result.shiftNumber,
      documentCount: result.documentCount,
      rawData: result.rawData,
    });
    console.info('[fiscal-z-report] force run complete', { alreadyClosed: result.alreadyClosed });
  } catch (err) {
    const msg = (err as Error).message;
    const code = err instanceof WebkassaApiError ? String(err.code) : undefined;
    await updateZReportRow(rowId, { status: 'failed', errorCode: code, errorMessage: msg, rawData: null });
    console.error('[fiscal-z-report] force run failed:', msg);
    void (WebkassaNetworkError);
  }
}
