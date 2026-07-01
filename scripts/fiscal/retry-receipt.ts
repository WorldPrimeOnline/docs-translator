/**
 * Retry a stuck fiscal receipt through the Webkassa queue.
 *
 * Looks up an existing pending/retry_required/failed fiscal receipt and processes it
 * through the same Webkassa cashbox queue used by the Railway worker.
 *
 * Usage:
 *   npx tsx scripts/fiscal/retry-receipt.ts --payment <payment_transaction_id>
 *   npx tsx scripts/fiscal/retry-receipt.ts --receipt <fiscal_receipt_id>
 *
 * Required env vars (copy from Railway production env or .env.production.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   WEBKASSA_API_BASE_URL          (e.g. https://api.webkassa.kz for production)
 *   WEBKASSA_API_KEY
 *   WEBKASSA_LOGIN
 *   WEBKASSA_PASSWORD              (never logged)
 *   WEBKASSA_CASHBOX_SERIAL_NUMBER
 *   WEBKASSA_ALLOW_REAL_RECEIPTS=true   (required for production receipts)
 *   FISCAL_PROVIDER_ENV=production
 *   WEBKASSA_ENABLED=true
 *
 * Safety:
 * - Refuses to process a receipt that already has provider_receipt_id or fiscal_url set.
 * - Does NOT create new payments or fiscal_receipt rows.
 * - Uses ExternalCheckNumber idempotency: safe to call if unsure whether prior attempt succeeded
 *   (Webkassa Error 14 → returns existing receipt, no duplicate issued).
 *
 * Recovery commands for known stuck receipts:
 *   npx tsx scripts/fiscal/retry-receipt.ts --receipt 698fd397-6397-4529-8d42-4b1346006f37
 *   npx tsx scripts/fiscal/retry-receipt.ts --payment d5b84752-6bf4-4c70-bb28-20767ee59a15
 */

import { createClient } from '@supabase/supabase-js';
import {
  createCheck,
  createZReport,
  WebkassaApiError,
  WebkassaNetworkError,
  WEBKASSA_ERROR_SHIFT_OVER_24H,
  sanitizeForStorage,
  type WebkassaConfig,
  type WebkassaCheckRequest,
} from '../../worker/src/lib/webkassa-client';
import * as crypto from 'crypto';

// ─── Env reading (no env.ts — this script loads only what it needs) ───────────

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`[retry-receipt] Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function getConfig(): WebkassaConfig {
  const enabled = process.env.WEBKASSA_ENABLED;
  if (enabled !== 'true') {
    console.error('[retry-receipt] WEBKASSA_ENABLED is not set to true — aborting');
    process.exit(1);
  }
  const fiscalEnv = process.env.FISCAL_PROVIDER_ENV ?? 'test';
  const allowReal = process.env.WEBKASSA_ALLOW_REAL_RECEIPTS;
  if (fiscalEnv === 'production' && allowReal !== 'true') {
    console.error('[retry-receipt] FISCAL_PROVIDER_ENV=production but WEBKASSA_ALLOW_REAL_RECEIPTS is not set to true — aborting to prevent accidental production calls');
    process.exit(1);
  }

  return {
    apiBaseUrl: (process.env.WEBKASSA_API_BASE_URL ?? 'https://devkkm.webkassa.kz').replace(/\/$/, ''),
    apiKey: requireEnv('WEBKASSA_API_KEY'),
    login: requireEnv('WEBKASSA_LOGIN'),
    password: requireEnv('WEBKASSA_PASSWORD'),
    cashboxUniqueNumber: requireEnv('WEBKASSA_CASHBOX_SERIAL_NUMBER'),
    timeoutMs: 30_000,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toIsoDateTime(dt: string): string {
  const m = dt.match(/^(\d{2})\.(\d{2})\.(\d{4}) (.+)$/);
  if (!m) return dt;
  return `${m[3]}-${m[2]}-${m[1]} ${m[4]}`;
}

interface FiscalReceiptRow {
  id: string;
  payment_transaction_id: string;
  operation_type: string;
  amount_kzt: number;
  currency: string;
  customer_email: string | null;
  receipt_payload_sanitized: Record<string, unknown> | null;
  retry_count: number;
  status: string;
  provider_receipt_id: string | null;
  fiscal_url: string | null;
  provider: string;
}

// ─── Core receipt processing (mirrors fiscal-processor.ts logic) ──────────────

async function processReceipt(
  receipt: FiscalReceiptRow,
  cfg: WebkassaConfig,
  supabase: ReturnType<typeof createClient>,
  shiftRetryCount = 0,
): Promise<void> {
  const isSale = receipt.operation_type === 'sale';
  const operationType = isSale ? 2 : 3;

  const payload = receipt.receipt_payload_sanitized ?? {};
  const orderNumber = (payload['orderNumber'] as string | undefined)
    ?? receipt.payment_transaction_id.slice(0, 8).toUpperCase();
  const serviceName = (payload['description'] as string | undefined)
    ?? (isSale ? 'Услуга перевода документа' : 'Возврат: услуга перевода документа');

  const amountKzt = Math.round(receipt.amount_kzt);
  const refundTransactionId = payload['refundTransactionId'] as string | undefined;
  const externalCheckNumber =
    !isSale && refundTransactionId ? refundTransactionId : receipt.payment_transaction_id;
  const originalExternalCheckNumber = !isSale ? receipt.payment_transaction_id : undefined;

  // For refunds: look up returnBasisDetails from original sale
  let returnBasisDetails: WebkassaCheckRequest['returnBasisDetails'];
  if (!isSale) {
    const { data: origSale } = await supabase
      .from('fiscal_receipts')
      .select('provider_response_sanitized')
      .eq('payment_transaction_id', receipt.payment_transaction_id)
      .eq('operation_type', 'sale')
      .eq('status', 'issued')
      .single();
    const r = (origSale as { provider_response_sanitized?: Record<string, unknown> } | null)
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
      console.warn('[retry-receipt] returnBasisDetails: no issued original sale found — proceeding without it');
    }
  }

  try {
    const result = await createCheck(cfg, {
      OperationType: operationType as 0 | 1 | 2 | 3,
      Positions: [{
        Count: 1,
        Price: amountKzt,
        TaxPercent: 0,
        Tax: 0,
        TaxType: 0 as const,
        PositionName: serviceName,
        PositionCode: orderNumber,
        UnitCode: 796,
        Discount: 0,
        Markup: 0,
      }],
      Payments: [{ Sum: amountKzt, PaymentType: 1 }],
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

    console.log('[retry-receipt] receipt issued successfully', {
      receiptId: receipt.id,
      checkNumber: result.checkNumber,
      isDuplicate: result.isDuplicate,
      fiscalUrl: result.ticketUrl ?? result.ticketPrintUrl,
    });
  } catch (err) {
    if (
      err instanceof WebkassaApiError &&
      err.code === WEBKASSA_ERROR_SHIFT_OVER_24H &&
      shiftRetryCount < 1
    ) {
      console.warn('[retry-receipt] Error 11 (shift >24h) — running Z-report to close stale shift');
      try {
        await createZReport(cfg);
        console.log('[retry-receipt] Z-report completed; retrying receipt');
      } catch (zErr) {
        console.warn('[retry-receipt] Z-report failed (continuing):', (zErr as Error).message);
      }
      return processReceipt(receipt, cfg, supabase, shiftRetryCount + 1);
    }

    const msg = (err as Error).message;
    const code = err instanceof WebkassaApiError ? String(err.code) : undefined;
    const isRetryable = (err instanceof WebkassaNetworkError && err.isRetryable)
      || (err instanceof WebkassaApiError && err.isRetryable);
    const nextRetryCount = (receipt.retry_count ?? 0) + 1;
    const permanentlyFailed = !isRetryable;

    console.error('[retry-receipt] Webkassa error', {
      errorCode: code,
      message: msg,
      isRetryable,
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

    throw new Error(`Webkassa call failed (${code ?? 'network'}): ${msg}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const paymentIdx = args.indexOf('--payment');
  const receiptIdx = args.indexOf('--receipt');
  const paymentId = paymentIdx >= 0 ? args[paymentIdx + 1] : null;
  const receiptId = receiptIdx >= 0 ? args[receiptIdx + 1] : null;

  if (!paymentId && !receiptId) {
    console.error('Usage:');
    console.error('  npx tsx scripts/fiscal/retry-receipt.ts --payment <payment_transaction_id>');
    console.error('  npx tsx scripts/fiscal/retry-receipt.ts --receipt <fiscal_receipt_id>');
    process.exit(1);
  }

  const cfg = getConfig();
  console.log('[retry-receipt] Webkassa config loaded', {
    apiBaseUrl: cfg.apiBaseUrl,
    cashboxUniqueNumber: cfg.cashboxUniqueNumber,
    hasApiKey: !!cfg.apiKey,
    FISCAL_PROVIDER_ENV: process.env.FISCAL_PROVIDER_ENV ?? 'test',
  });

  const supabaseUrl = requireEnv('NEXT_PUBLIC_SUPABASE_URL');
  const supabaseKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const db = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false },
  });

  // Resolve target receipt
  let target: FiscalReceiptRow | null = null;

  if (receiptId) {
    const { data, error } = await db
      .from('fiscal_receipts')
      .select('id, payment_transaction_id, operation_type, amount_kzt, currency, customer_email, receipt_payload_sanitized, retry_count, status, provider_receipt_id, fiscal_url, provider')
      .eq('id', receiptId)
      .single();
    if (error || !data) {
      console.error(`[retry-receipt] Receipt not found: ${receiptId}`, error?.message);
      process.exit(1);
    }
    target = data as FiscalReceiptRow;
  } else if (paymentId) {
    const { data, error } = await db
      .from('fiscal_receipts')
      .select('id, payment_transaction_id, operation_type, amount_kzt, currency, customer_email, receipt_payload_sanitized, retry_count, status, provider_receipt_id, fiscal_url, provider')
      .eq('payment_transaction_id', paymentId)
      .eq('operation_type', 'sale')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (error || !data) {
      console.error(`[retry-receipt] No fiscal receipt found for payment ${paymentId}`, error?.message);
      process.exit(1);
    }
    target = data as FiscalReceiptRow;
    console.log(`[retry-receipt] Found receipt for payment ${paymentId}: ${target.id}`);
  }

  if (!target) {
    console.error('[retry-receipt] Could not resolve receipt');
    process.exit(1);
  }

  console.log('[retry-receipt] Receipt details', {
    id: target.id,
    status: target.status,
    provider: target.provider,
    operationType: target.operation_type,
    amountKzt: target.amount_kzt,
    retryCount: target.retry_count,
    hasProviderReceiptId: !!target.provider_receipt_id,
    hasFiscalUrl: !!target.fiscal_url,
  });

  // Safety guards
  if (target.provider_receipt_id || target.fiscal_url) {
    console.error('[retry-receipt] Receipt already has provider_receipt_id or fiscal_url — refusing to re-process (would create duplicate). Receipt may already be issued.');
    console.error('  provider_receipt_id:', target.provider_receipt_id);
    console.error('  fiscal_url:', target.fiscal_url);
    process.exit(1);
  }

  if (!['pending', 'retry_required', 'failed'].includes(target.status)) {
    console.error(`[retry-receipt] Receipt status is '${target.status}' — only pending/retry_required/failed can be retried`);
    process.exit(1);
  }

  if (target.provider !== 'webkassa') {
    console.error(`[retry-receipt] Receipt provider is '${target.provider}', not 'webkassa' — this script only handles Webkassa receipts`);
    process.exit(1);
  }

  // Process
  console.log('[retry-receipt] Processing receipt through Webkassa...');
  await processReceipt(target, cfg, db);

  console.log('[retry-receipt] Done. Verify in fiscal_receipts table:');
  console.log(`  SELECT status, provider_receipt_id, fiscal_url FROM fiscal_receipts WHERE id = '${target.id}';`);
}

main().catch((err: unknown) => {
  console.error('[retry-receipt] Fatal error:', (err as Error).message);
  process.exit(1);
});
