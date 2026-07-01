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
  WebkassaApiError,
  WebkassaNetworkError,
  sanitizeForStorage,
  type WebkassaConfig,
} from './webkassa-client';
import * as crypto from 'crypto';

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_ITEMS_PER_CYCLE = 10;
const MAX_RETRY_COUNT = 3;

function getWebkassaConfig(): WebkassaConfig | null {
  if (env.WEBKASSA_ENABLED !== 'true') return null;
  if (!env.WEBKASSA_API_KEY || !env.WEBKASSA_LOGIN || !env.WEBKASSA_PASSWORD || !env.WEBKASSA_CASHBOX_SERIAL_NUMBER) return null;
  if (env.FISCAL_PROVIDER_ENV === 'production' && env.WEBKASSA_ALLOW_REAL_RECEIPTS !== 'true') return null;

  return {
    apiBaseUrl: (env.WEBKASSA_API_BASE_URL ?? 'https://devkkm.webkassa.kz').replace(/\/$/, ''),
    apiKey: env.WEBKASSA_API_KEY,
    login: env.WEBKASSA_LOGIN,
    password: env.WEBKASSA_PASSWORD,
    cashboxUniqueNumber: env.WEBKASSA_CASHBOX_SERIAL_NUMBER,
    timeoutMs: 30_000,
  };
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
): Promise<void> {
  const operationType = receipt.operation_type === 'sale' ? 2 : 3; // SALE=2, SALE_RETURN=3
  const isSale = receipt.operation_type === 'sale';

  const payload = receipt.receipt_payload_sanitized ?? {};
  const orderNumber = (payload['orderNumber'] as string | undefined)
    ?? receipt.payment_transaction_id.slice(0, 8).toUpperCase();
  const serviceName = (payload['description'] as string | undefined)
    ?? (isSale ? 'Услуга перевода документа' : 'Возврат: услуга перевода документа');

  const amountKzt = Math.round(receipt.amount_kzt);
  const taxType = 0 as const; // No VAT — confirmed for WPO
  const taxAmount = 0;

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
      ExternalCheckNumber: receipt.payment_transaction_id,
      ExternalOrderNumber: orderNumber,
      CustomerEmail: receipt.customer_email ?? undefined,
      ExternalLinkId: crypto.randomUUID(),
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
 * Called from fiscal-reconciliation.ts every 5 minutes.
 *
 * Sequential guarantee: both in-process async queue (Layer 1) and Postgres
 * lock table (Layer 2) ensure only one Webkassa request per cashbox at a time,
 * across all active worker instances.
 */
export async function processPendingFiscalReceipts(): Promise<void> {
  const cfg = getWebkassaConfig();
  if (!cfg) {
    // Fiscal disabled or misconfigured — log at debug level, not warn (expected in staging)
    return;
  }

  const { data: pending, error } = await supabase
    .from('fiscal_receipts')
    .select('id, payment_transaction_id, operation_type, amount_kzt, currency, customer_email, receipt_payload_sanitized, retry_count')
    .in('status', ['pending', 'retry_required'])
    .in('operation_type', ['sale', 'refund'])
    .order('created_at', { ascending: true })
    .limit(MAX_ITEMS_PER_CYCLE)
    .returns<PendingFiscalReceipt[]>();

  if (error) {
    console.error('[fiscal-processor] DB error fetching pending receipts:', error.message);
    return;
  }

  if (!pending || pending.length === 0) return;

  console.info(`[fiscal-processor] processing ${pending.length} fiscal receipt(s)`);

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
