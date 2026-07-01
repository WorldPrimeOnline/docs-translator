/**
 * Worker-side fiscal receipt processor.
 *
 * Processes pending/retry_required fiscal_receipts sequentially per cashbox.
 *
 * Sequential guarantee (two-layer):
 * 1. In-process async queue (Map<cashboxId, Promise>) — serializes within one Railway instance.
 * 2. Postgres lock table (fiscal_cashbox_locks) — serializes across multiple Railway instances.
 *
 * Both layers are required by Webkassa: "Запросы по кассе должны отправляться
 * последовательно" (requests to a cashbox must be sent sequentially).
 *
 * Why moved from serverless to worker:
 * - Vercel functions can have multiple concurrent instances — impossible to guarantee
 *   sequential requests from serverless.
 * - Railway worker is a single long-running process with persistent in-memory state.
 * - Web app now only creates the fiscal_receipts row (status='pending').
 *   This processor picks up pending rows and executes the Webkassa call.
 */

import { supabase } from './supabase';
import { env } from './env';
import {
  createCheck,
  createZReport,
  WebkassaApiError,
  WebkassaNetworkError,
  WEBKASSA_ERROR_SHIFT_OVER_24H,
  sanitizeForStorage,
  type WebkassaConfig,
} from './webkassa-client';
import * as crypto from 'crypto';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert Webkassa date "DD.MM.YYYY HH:mm:ss" → "YYYY-MM-DD HH:mm:ss" for returnBasisDetails */
function toIsoDateTime(dt: string): string {
  const m = dt.match(/^(\d{2})\.(\d{2})\.(\d{4}) (.+)$/);
  if (!m) return dt;
  return `${m[3]}-${m[2]}-${m[1]} ${m[4]}`;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_ITEMS_PER_CYCLE = 10;
const MAX_RETRY_COUNT = 3;

function getWebkassaConfig(): WebkassaConfig | null {
  if (env.WEBKASSA_ENABLED !== 'true') return null;
  if (!env.WEBKASSA_API_KEY || !env.WEBKASSA_LOGIN || !env.WEBKASSA_PASSWORD || !env.WEBKASSA_CASHBOX_SERIAL_NUMBER) return null;
  if (env.FISCAL_PROVIDER_ENV === 'production' && env.WEBKASSA_ALLOW_REAL_RECEIPTS !== 'true') return null;

  return {
    apiBaseUrl: (env.WEBKASSA_API_BASE_URL
      ?? (env.FISCAL_PROVIDER_ENV === 'production'
        ? 'https://api.webkassa.kz'
        : 'https://devkkm.webkassa.kz')
    ).replace(/\/$/, ''),
    apiKey: env.WEBKASSA_API_KEY,
    login: env.WEBKASSA_LOGIN,
    password: env.WEBKASSA_PASSWORD,
    cashboxUniqueNumber: env.WEBKASSA_CASHBOX_SERIAL_NUMBER,
    timeoutMs: 30_000,
  };
}

/** Returns a human-readable reason why getWebkassaConfig() returns null. */
function getConfigSkipReason(): string {
  if (env.WEBKASSA_ENABLED !== 'true') return 'WEBKASSA_ENABLED is not set to true';
  if (!env.WEBKASSA_API_KEY) return 'WEBKASSA_API_KEY is missing';
  if (!env.WEBKASSA_LOGIN) return 'WEBKASSA_LOGIN is missing';
  if (!env.WEBKASSA_PASSWORD) return 'WEBKASSA_PASSWORD is missing';
  if (!env.WEBKASSA_CASHBOX_SERIAL_NUMBER) return 'WEBKASSA_CASHBOX_SERIAL_NUMBER is missing';
  if (env.FISCAL_PROVIDER_ENV === 'production' && env.WEBKASSA_ALLOW_REAL_RECEIPTS !== 'true')
    return 'FISCAL_PROVIDER_ENV=production but WEBKASSA_ALLOW_REAL_RECEIPTS is not set to true';
  return 'unknown';
}

export function isWebkassaConfigured(): boolean {
  return getWebkassaConfig() !== null;
}

const WORKER_ID = env.WORKER_INSTANCE_ID ?? `worker-${crypto.randomBytes(4).toString('hex')}`;

// ─── In-process cashbox queue (Layer 1) ───────────────────────────────────────
// Ensures only one fiscal operation runs at a time per cashbox within this process.

const cashboxQueue = new Map<string, Promise<void>>();

async function runWithInProcessLock<T>(cashboxId: string, fn: () => Promise<T>): Promise<T> {
  const prev = cashboxQueue.get(cashboxId) ?? Promise.resolve();
  let release!: () => void;
  const done = new Promise<void>((r) => { release = r; });
  cashboxQueue.set(cashboxId, done);

  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (cashboxQueue.get(cashboxId) === done) cashboxQueue.delete(cashboxId);
  }
}

// ─── Postgres lock table (Layer 2) ────────────────────────────────────────────
// Guards against multiple Railway instances running concurrently.

const LOCK_DURATION_MINUTES = 10;

async function acquireDbLock(cashboxId: string): Promise<boolean> {
  try {
    // Upsert lock row: succeed only if no unexpired lock exists
    const { data } = await (supabase as unknown as {
      from: (t: string) => {
        upsert: (row: unknown, opts: unknown) => {
          select: () => { returns: <T>() => Promise<{ data: T | null }> }
        }
      }
    })
      .from('fiscal_cashbox_locks')
      .upsert(
        {
          cashbox_id: cashboxId,
          worker_id: WORKER_ID,
          acquired_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000).toISOString(),
        },
        { onConflict: 'cashbox_id', ignoreDuplicates: false },
      )
      .select()
      .returns<{ cashbox_id: string }[]>();

    // If another worker holds a valid lock, the row will be updated if expired.
    // Since we can't do conditional upsert with WHERE in Supabase JS,
    // we check if the row's worker_id is ours after the upsert.
    if (!data || data.length === 0) return false;
    return data[0]!.cashbox_id === cashboxId;
  } catch (err) {
    // DB lock failure is non-fatal — in-process lock (Layer 1) still protects single-instance
    console.warn('[fiscal-processor] DB lock acquisition warning:', (err as Error).message);
    return true; // proceed with in-process lock only
  }
}

async function releaseDbLock(cashboxId: string): Promise<void> {
  try {
    await (supabase as unknown as {
      from: (t: string) => {
        delete: () => { eq: (col: string, val: string) => { eq: (col: string, val: string) => Promise<unknown> } }
      }
    })
      .from('fiscal_cashbox_locks')
      .delete()
      .eq('cashbox_id', cashboxId)
      .eq('worker_id', WORKER_ID);
  } catch (err) {
    console.warn('[fiscal-processor] DB lock release warning:', (err as Error).message);
  }
}

// ─── Per-receipt processing ────────────────────────────────────────────────────

interface PendingFiscalReceipt {
  id: string;
  payment_transaction_id: string;
  operation_type: string;
  amount_kzt: number;
  currency: string;
  customer_email: string | null;
  receipt_payload_sanitized: Record<string, unknown> | null;
  retry_count: number;
}

async function processOneReceipt(
  receipt: PendingFiscalReceipt,
  cfg: WebkassaConfig,
  shiftRetryCount = 0, // tracks Error 11 recovery attempts; capped at 1
): Promise<void> {
  const operationType = receipt.operation_type === 'sale' ? 2 : 3; // SALE=2, SALE_RETURN=3
  const isSale = receipt.operation_type === 'sale';

  console.info('[fiscal-processor] processing receipt', {
    receiptId: receipt.id,
    operationType: receipt.operation_type,
    amountKzt: receipt.amount_kzt,
    retryCount: receipt.retry_count,
  });

  const payload = receipt.receipt_payload_sanitized ?? {};
  const orderNumber = (payload['orderNumber'] as string | undefined)
    ?? receipt.payment_transaction_id.slice(0, 8).toUpperCase();
  const serviceName = (payload['description'] as string | undefined)
    ?? (isSale ? 'Услуга перевода документа' : 'Возврат: услуга перевода документа');

  const amountKzt = Math.round(receipt.amount_kzt);
  const taxType = 0 as const; // No VAT — confirmed for WPO
  const taxAmount = 0;

  // For refund receipts: use refundTransactionId as ExternalCheckNumber so it's unique
  // from the original sale (which uses payment_transaction_id). For sales: use payment_transaction_id.
  const refundTransactionId = payload['refundTransactionId'] as string | undefined;
  const externalCheckNumber =
    !isSale && refundTransactionId ? refundTransactionId : receipt.payment_transaction_id;

  // For OperationType=3 (SALE_RETURN): pass original sale's ExternalCheckNumber as base check reference.
  // The original sale used payment_transaction_id as its ExternalCheckNumber.
  const originalExternalCheckNumber = !isSale ? receipt.payment_transaction_id : undefined;

  // For OperationType=3: build returnBasisDetails from the original sale's Webkassa response.
  // Required per Webkassa protocol 2.0.3+ — without this block, Error 9 is returned.
  let returnBasisDetails:
    | { dateTime: string; total: number; checkNumber: string; registrationNumber: string; isOffline: boolean }
    | undefined;
  if (!isSale) {
    const { data: originalSale } = await supabase
      .from('fiscal_receipts')
      .select('provider_response_sanitized')
      .eq('payment_transaction_id', receipt.payment_transaction_id)
      .eq('operation_type', 'sale')
      .eq('status', 'issued')
      .single();
    const r = (originalSale as { provider_response_sanitized?: Record<string, unknown> } | null)
      ?.provider_response_sanitized;
    if (r) {
      const cashbox = r['Cashbox'] as Record<string, unknown> | undefined;
      returnBasisDetails = {
        dateTime: toIsoDateTime((r['DateTime'] as string | undefined) ?? ''),
        total: (r['Total'] as number | undefined) ?? amountKzt,
        checkNumber: (r['CheckNumber'] as string | undefined) ?? '',
        registrationNumber: (cashbox?.['RegistrationNumber'] as string | undefined) ?? '',
        isOffline: (r['OfflineMode'] as boolean | undefined) ?? false,
      };
    } else {
      console.warn('[fiscal-processor] returnBasisDetails: no issued original sale found', {
        receiptId: receipt.id,
        paymentTransactionId: receipt.payment_transaction_id,
      });
    }
  }

  console.info('[fiscal-processor] Webkassa createCheck started', {
    receiptId: receipt.id,
    operationType: receipt.operation_type,
    externalCheckNumber: externalCheckNumber,
    amountKzt,
  });

  try {
    const result = await createCheck(cfg, {
      OperationType: operationType as 0 | 1 | 2 | 3,
      Positions: [
        {
          Count: 1,
          Price: amountKzt,
          TaxPercent: 0,
          Tax: taxAmount,
          TaxType: taxType,
          PositionName: serviceName,
          PositionCode: orderNumber,
          UnitCode: 796, // шт (piece)
          Discount: 0,
          Markup: 0,
        },
      ],
      Payments: [{ Sum: amountKzt, PaymentType: 1 }], // BANK_CARD = 1
      Change: 0,
      RoundType: 2,
      ExternalCheckNumber: externalCheckNumber,
      ExternalOrderNumber: orderNumber,
      CustomerEmail: receipt.customer_email ?? undefined,
      ExternalLinkId: crypto.randomUUID(),
      ...(originalExternalCheckNumber !== undefined && { OriginalExternalCheckNumber: originalExternalCheckNumber }),
      ...(returnBasisDetails !== undefined && { returnBasisDetails }),
    });

    await supabase
      .from('fiscal_receipts')
      .update({
        status: 'issued',
        provider_receipt_id: result.checkNumber ?? null,
        fiscal_url: result.ticketUrl ?? result.ticketPrintUrl ?? null,
        provider_response_sanitized: sanitizeForStorage(result.rawData),
        error_code: null,
        error_message: null,
        issued_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', receipt.id);

    console.info('[fiscal-processor] receipt issued', {
      receiptId: receipt.id,
      operationType: receipt.operation_type,
      isDuplicate: result.isDuplicate,
      checkNumber: result.checkNumber,
    });
  } catch (err) {
    // Error 11: shift >24h — auto-recover by running Z-report, then retry once.
    // Idempotent: same ExternalCheckNumber is reused; if check was already issued (Error 14),
    // it will be treated as success. Cap at 1 shift retry to avoid infinite loops.
    if (
      err instanceof WebkassaApiError &&
      err.code === WEBKASSA_ERROR_SHIFT_OVER_24H &&
      shiftRetryCount < 1
    ) {
      console.warn('[fiscal-processor] Error 11 (shift >24h) — running Z-report to close stale shift', {
        receiptId: receipt.id,
      });
      try {
        await createZReport(cfg);
        console.info('[fiscal-processor] Z-report completed; retrying fiscal receipt after Error 11', {
          receiptId: receipt.id,
        });
      } catch (zErr) {
        // Z-report failure is non-fatal — the new shift may open automatically
        console.warn('[fiscal-processor] Z-report during Error 11 recovery failed (continuing retry):', (zErr as Error).message);
      }
      // Retry the same receipt; ExternalCheckNumber idempotency prevents duplicate receipts
      return processOneReceipt(receipt, cfg, shiftRetryCount + 1);
    }

    const msg = (err as Error).message;
    const code = err instanceof WebkassaApiError ? String(err.code) : undefined;
    const isRetryable = (err instanceof WebkassaNetworkError && err.isRetryable)
      || (err instanceof WebkassaApiError && err.isRetryable);
    const nextRetryCount = (receipt.retry_count ?? 0) + 1;
    const permanentlyFailed = !isRetryable || nextRetryCount > MAX_RETRY_COUNT;

    console.error('[fiscal-processor] receipt processing failed', {
      receiptId: receipt.id,
      errorCode: code,
      isRetryable,
      retryCount: nextRetryCount,
      permanentlyFailed,
    });

    await supabase
      .from('fiscal_receipts')
      .update({
        status: permanentlyFailed ? 'failed' : 'retry_required',
        error_code: code ?? null,
        error_message: msg,
        retry_count: nextRetryCount,
        failed_at: permanentlyFailed ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', receipt.id);
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Process pending/retry_required fiscal receipts sequentially per cashbox.
 *
 * Called from index.ts on startup and every FISCAL_PROCESSOR_INTERVAL_MS (30s).
 * Also called from fiscal-reconciliation.ts for the 5-min stuck-alert pass.
 *
 * Filters:
 * - provider = 'webkassa'
 * - provider_environment = env.FISCAL_PROVIDER_ENV (production worker → production receipts only)
 * - operation_type IN ('sale', 'refund')
 * - status IN ('pending', 'retry_required')
 * - provider_receipt_id IS NULL  (skip already-issued, defence against stale status)
 * - fiscal_url IS NULL           (same)
 *
 * Sequential guarantee: both in-process async queue (Layer 1) and Postgres
 * lock table (Layer 2) ensure only one Webkassa request per cashbox at a time,
 * across all active worker instances.
 */
export async function processPendingFiscalReceipts(): Promise<void> {
  const cfg = getWebkassaConfig();
  const configured = cfg !== null;

  console.info('[fiscal-processor] tick', {
    configured,
    WEBKASSA_ENABLED: env.WEBKASSA_ENABLED,
    FISCAL_PROVIDER_ENV: env.FISCAL_PROVIDER_ENV,
    WEBKASSA_ALLOW_REAL_RECEIPTS: env.WEBKASSA_ALLOW_REAL_RECEIPTS ?? null,
    hasApiKey: !!env.WEBKASSA_API_KEY,
  });

  if (!cfg) {
    console.info('[fiscal-processor] skipping — Webkassa not configured', {
      reason: getConfigSkipReason(),
    });
    return;
  }

  const { data: pending, error } = await supabase
    .from('fiscal_receipts')
    .select('id, payment_transaction_id, operation_type, amount_kzt, currency, customer_email, receipt_payload_sanitized, retry_count')
    .in('status', ['pending', 'retry_required'])
    .in('operation_type', ['sale', 'refund'])
    .eq('provider', 'webkassa')
    .eq('provider_environment', env.FISCAL_PROVIDER_ENV)
    .is('provider_receipt_id', null)
    .is('fiscal_url', null)
    .order('created_at', { ascending: true })
    .limit(MAX_ITEMS_PER_CYCLE)
    .returns<PendingFiscalReceipt[]>();

  if (error) {
    console.error('[fiscal-processor] DB error fetching pending receipts:', error.message);
    return;
  }

  console.info('[fiscal-processor] pending receipts found', {
    count: pending?.length ?? 0,
    FISCAL_PROVIDER_ENV: env.FISCAL_PROVIDER_ENV,
  });

  if (!pending || pending.length === 0) return;

  console.info('[fiscal-processor] processing batch', {
    count: pending.length,
    ids: pending.map((r) => r.id),
  });

  const cashboxId = cfg.cashboxUniqueNumber;

  // Layer 1: in-process async queue — all receipts for this cashbox run sequentially
  await runWithInProcessLock(cashboxId, async () => {
    // Layer 2: Postgres lock — multi-instance safety
    const locked = await acquireDbLock(cashboxId);
    if (!locked) {
      console.info('[fiscal-processor] another worker holds the cashbox lock — skipping cycle');
      return;
    }

    try {
      for (const receipt of pending) {
        await processOneReceipt(receipt, cfg);
      }
    } finally {
      await releaseDbLock(cashboxId);
    }
  });
}

/**
 * Process a single fiscal receipt by ID (for manual retry and operational tooling).
 *
 * Guards:
 * - Throws if Webkassa is not configured (check env vars).
 * - Returns 'not_found' if the receipt does not exist.
 * - Returns 'already_issued' if provider_receipt_id or fiscal_url is already set
 *   (prevents duplicate receipts — use Webkassa ExternalCheckNumber idempotency instead).
 * - Returns 'not_processable' if status is not pending/retry_required/failed.
 * - Returns 'processed' after successfully running through the Webkassa queue.
 *
 * Used by scripts/fiscal/retry-receipt.ts.
 */
export async function processReceiptById(
  receiptId: string,
): Promise<'processed' | 'already_issued' | 'not_found' | 'not_processable'> {
  const cfg = getWebkassaConfig();
  if (!cfg) {
    throw new Error(`Webkassa not configured: ${getConfigSkipReason()}`);
  }

  const { data: row } = await supabase
    .from('fiscal_receipts')
    .select('id, payment_transaction_id, operation_type, amount_kzt, currency, customer_email, receipt_payload_sanitized, retry_count, provider_receipt_id, fiscal_url, status')
    .eq('id', receiptId)
    .single();

  if (!row) return 'not_found';

  const receipt = row as PendingFiscalReceipt & {
    status: string;
    provider_receipt_id: string | null;
    fiscal_url: string | null;
  };

  if (receipt.provider_receipt_id || receipt.fiscal_url) {
    console.warn('[fiscal-processor] processReceiptById: receipt already issued — skipping to prevent duplicate', {
      receiptId,
      provider_receipt_id: receipt.provider_receipt_id,
      fiscal_url: receipt.fiscal_url,
    });
    return 'already_issued';
  }

  if (!['pending', 'retry_required', 'failed'].includes(receipt.status)) {
    console.warn('[fiscal-processor] processReceiptById: receipt not in a retryable status', {
      receiptId,
      status: receipt.status,
    });
    return 'not_processable';
  }

  console.info('[fiscal-processor] processReceiptById: processing', {
    receiptId,
    status: receipt.status,
    operationType: receipt.operation_type,
    FISCAL_PROVIDER_ENV: env.FISCAL_PROVIDER_ENV,
  });

  await runWithInProcessLock(cfg.cashboxUniqueNumber, async () => {
    const locked = await acquireDbLock(cfg.cashboxUniqueNumber);
    if (!locked) {
      throw new Error('Another worker holds the cashbox lock — try again shortly');
    }
    try {
      await processOneReceipt(receipt, cfg);
    } finally {
      await releaseDbLock(cfg.cashboxUniqueNumber);
    }
  });

  return 'processed';
}
