/**
 * Freedom Pay Merchant API client — server-only module.
 *
 * Endpoints per docs.freedompay.kz (source of truth per 2026-08-20 scope correction —
 * do NOT use freedompay.kz/docs/merchant-api's /init_payment.php or /revoke.php
 * variants; /init_payment.php belongs to a different product — Mobile balance — on
 * the current docs.freedompay.kz):
 *
 *   create payment → POST https://api.freedompay.kz/init_payment   (request JSON, response XML)
 *   status check   → POST https://api.freedompay.kz/get_status3.php (request form-urlencoded, response XML)
 *   refund         → POST https://api.freedompay.kz/revoke          (request multipart/form-data,
 *                    response XML — confirmed against the current Create Payment /
 *                    Refund documentation on docs.freedompay.kz, 2026-08-20 pre-deploy
 *                    correction pass)
 */
import { randomBytes } from 'crypto';
import { getFreedomPayConfig } from './config';
import { buildSignature, FREEDOMPAY_SCRIPT_NAMES } from './signature';
import { parseFreedomPayXml } from './xml';

const FETCH_TIMEOUT_MS = 15_000;

export class FreedomPayApiError extends Error {
  readonly code: string;
  readonly httpStatus?: number;
  readonly responseBodySnippet?: string;

  constructor(params: { message?: string; code: string; httpStatus?: number; responseBodySnippet?: string }) {
    super(params.message ?? params.code);
    this.name = 'FreedomPayApiError';
    this.code = params.code;
    this.httpStatus = params.httpStatus;
    this.responseBodySnippet = params.responseBodySnippet;
  }
}

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

function newSalt(): string {
  return randomBytes(16).toString('hex');
}

// ─── Create payment ─────────────────────────────────────────────────────────────

export interface InitPaymentParams {
  /** payment_transactions.id, reused directly as pg_order_id — immutable, unique,
   * created before this call, maps back to exactly one WPO payment. */
  orderId: string;
  amountKzt: number;
  description: string;
  resultUrl: string;
  successUrl: string;
  failureUrl: string;
}

export interface InitPaymentResult {
  redirectUrl: string;
  pgPaymentId?: string;
}

/**
 * pg_redirect_url is the confirmed response field for the hosted-page redirect URL
 * (current docs.freedompay.kz Create Payment documentation, verified directly —
 * no longer a naming assumption).
 */
export async function initPayment(params: InitPaymentParams): Promise<InitPaymentResult> {
  const config = getFreedomPayConfig();
  if (!config.enabled) {
    throw new FreedomPayApiError({ message: 'Freedom Pay is not enabled', code: 'FREEDOMPAY_DISABLED' });
  }

  const fields: Record<string, string> = {
    pg_order_id: params.orderId,
    pg_merchant_id: config.merchantId,
    pg_amount: String(Math.round(params.amountKzt)),
    pg_description: params.description,
    pg_currency: 'KZT',
    pg_result_url: params.resultUrl,
    pg_success_url: params.successUrl,
    pg_failure_url: params.failureUrl,
    pg_request_method: 'POST',
    // Explicit one-step auto-clearing per the user's confirmation that pg_auto_clearing
    // is documented on the current Create Payment page — WPO always wants immediate
    // charge-on-authorization, never leaving this to the account's implicit default.
    pg_auto_clearing: '1',
    pg_salt: newSalt(),
  };

  const sig = buildSignature(FREEDOMPAY_SCRIPT_NAMES.createPayment, fields, config.secretKey);
  const requestBody = JSON.stringify({ ...fields, pg_sig: sig });

  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}/init_payment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: requestBody,
      signal: withTimeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new FreedomPayApiError({ message: 'Network error calling init_payment', code: 'FREEDOMPAY_INIT_NETWORK_ERROR' });
  }

  const rawText = await response.text();

  if (!response.ok) {
    throw new FreedomPayApiError({
      message: `Freedom Pay init_payment HTTP ${response.status}`,
      code: 'FREEDOMPAY_INIT_HTTP_ERROR',
      httpStatus: response.status,
      responseBodySnippet: rawText.slice(0, 500),
    });
  }

  let parsed: Record<string, string>;
  try {
    parsed = parseFreedomPayXml(rawText);
  } catch {
    throw new FreedomPayApiError({
      message: 'Freedom Pay init_payment returned unparseable XML',
      code: 'FREEDOMPAY_INIT_PARSE_ERROR',
      responseBodySnippet: rawText.slice(0, 500),
    });
  }

  const redirectUrl = parsed.pg_redirect_url;
  if (parsed.pg_status !== 'ok' || !redirectUrl) {
    throw new FreedomPayApiError({
      message: `Freedom Pay init_payment rejected: ${parsed.pg_error_description ?? parsed.pg_description ?? 'unknown'}`,
      code: 'FREEDOMPAY_INIT_REJECTED',
      responseBodySnippet: rawText.slice(0, 500),
    });
  }

  return { redirectUrl, pgPaymentId: parsed.pg_payment_id };
}

// ─── Status check ─────────────────────────────────────────────────────────────

export interface StatusResult {
  pgResult?: string;
  pgPaymentId?: string;
  amount?: string;
  currency?: string;
  raw: Record<string, string>;
}

export async function checkStatus(orderId: string): Promise<StatusResult> {
  const config = getFreedomPayConfig();
  if (!config.enabled) {
    throw new FreedomPayApiError({ message: 'Freedom Pay is not enabled', code: 'FREEDOMPAY_DISABLED' });
  }

  const fields: Record<string, string> = {
    pg_order_id: orderId,
    pg_merchant_id: config.merchantId,
    pg_salt: newSalt(),
  };
  const sig = buildSignature(FREEDOMPAY_SCRIPT_NAMES.status, fields, config.secretKey);
  const body = new URLSearchParams({ ...fields, pg_sig: sig });

  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}/get_status3.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: withTimeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new FreedomPayApiError({ message: 'Network error calling get_status3.php', code: 'FREEDOMPAY_STATUS_NETWORK_ERROR' });
  }

  const rawText = await response.text();

  if (!response.ok) {
    throw new FreedomPayApiError({
      message: `Freedom Pay get_status3.php HTTP ${response.status}`,
      code: 'FREEDOMPAY_STATUS_HTTP_ERROR',
      httpStatus: response.status,
      responseBodySnippet: rawText.slice(0, 500),
    });
  }

  let parsed: Record<string, string>;
  try {
    parsed = parseFreedomPayXml(rawText);
  } catch {
    throw new FreedomPayApiError({
      message: 'Freedom Pay get_status3.php returned unparseable XML',
      code: 'FREEDOMPAY_STATUS_PARSE_ERROR',
      responseBodySnippet: rawText.slice(0, 500),
    });
  }

  return {
    pgResult: parsed.pg_result,
    pgPaymentId: parsed.pg_payment_id,
    amount: parsed.pg_amount,
    currency: parsed.pg_currency,
    raw: parsed,
  };
}

// ─── Refund ─────────────────────────────────────────────────────────────────────

export interface RefundParams {
  pgPaymentId: string;
  /** Omit for a full refund of the original amount. */
  amountKzt?: number;
  /**
   * WPO's own refund_transactions.idempotency_key, passed through as pg_idempotency_key
   * (documented as an optional Refund param). Whether Freedom Pay actually deduplicates
   * on this field server-side is NOT independently confirmed — treat this as
   * defense-in-depth alongside WPO's own idempotency_key uniqueness check
   * (src/lib/refunds/service.ts), not as a substitute for it. Flagged as a
   * pre-production verification item.
   */
  idempotencyKey?: string;
}

export interface RefundResult {
  ok: boolean;
  raw: Record<string, string>;
}

/**
 * Content-Type is multipart/form-data (current docs.freedompay.kz Refund
 * documentation — corrected 2026-08-20 from an earlier, unverified
 * form-urlencoded assumption). fetch()/undici set the multipart boundary
 * automatically from a FormData body — do not set Content-Type manually.
 */
export async function refund(params: RefundParams): Promise<RefundResult> {
  const config = getFreedomPayConfig();
  if (!config.enabled) {
    throw new FreedomPayApiError({ message: 'Freedom Pay is not enabled', code: 'FREEDOMPAY_DISABLED' });
  }

  const fields: Record<string, string> = {
    pg_merchant_id: config.merchantId,
    pg_payment_id: params.pgPaymentId,
    pg_salt: newSalt(),
  };
  if (params.amountKzt !== undefined) {
    fields.pg_refund_amount = String(Math.round(params.amountKzt));
  }
  if (params.idempotencyKey) {
    fields.pg_idempotency_key = params.idempotencyKey;
  }

  const sig = buildSignature(FREEDOMPAY_SCRIPT_NAMES.refund, fields, config.secretKey);

  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  formData.append('pg_sig', sig);

  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}/revoke`, {
      method: 'POST',
      body: formData,
      signal: withTimeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new FreedomPayApiError({ message: 'Network error calling revoke', code: 'FREEDOMPAY_REFUND_NETWORK_ERROR' });
  }

  const rawText = await response.text();

  if (!response.ok) {
    throw new FreedomPayApiError({
      message: `Freedom Pay revoke HTTP ${response.status}`,
      code: 'FREEDOMPAY_REFUND_HTTP_ERROR',
      httpStatus: response.status,
      responseBodySnippet: rawText.slice(0, 500),
    });
  }

  let parsed: Record<string, string>;
  try {
    parsed = parseFreedomPayXml(rawText);
  } catch {
    throw new FreedomPayApiError({
      message: 'Freedom Pay revoke returned unparseable XML',
      code: 'FREEDOMPAY_REFUND_PARSE_ERROR',
      responseBodySnippet: rawText.slice(0, 500),
    });
  }

  return { ok: parsed.pg_status === 'ok', raw: parsed };
}
