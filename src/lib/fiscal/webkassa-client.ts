/**
 * Webkassa HTTP client.
 * Server-side only. Never import in client bundles.
 *
 * Auth: POST /api/v4/Authorize → token cached in module scope.
 * Token sent in request body (NOT as header). x-api-key sent as header on all requests.
 * Re-auth triggered on Error Code 2 (SESSION_EXPIRED).
 *
 * Safety: no secrets logged. No retry on fiscal errors (only transient/network errors).
 * ExternalCheckNumber = idempotency key (UUID). Duplicate → Error 14 + existing Data → treated as success.
 */

import {
  WebkassaAuthResponseSchema,
  WebkassaCashboxesResponseSchema,
  WebkassaCheckResponseSchema,
  WebkassaZReportResponseSchema,
  WEBKASSA_ERROR_CODES,
  RETRYABLE_ERROR_CODES,
  DUPLICATE_CHECK_CODE,
  Z_REPORT_ALREADY_DONE_CODES,
  type WebkassaCheckRequest,
  type WebkassaCheckData,
  type WebkassaZReportData,
} from './webkassa-types';

// ─── Config ───────────────────────────────────────────────────────────────────

export interface WebkassaClientConfig {
  apiBaseUrl: string;
  apiKey: string;
  login: string;
  password: string;
  cashboxUniqueNumber: string;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 1;  // One retry for transient errors only
const TOKEN_TTL_MS = 22 * 60 * 60 * 1000;  // 22 hours (sessions up to 24h)

// ─── Module-level token cache ─────────────────────────────────────────────────
// Cached per process. For serverless (Vercel), cache survives within a function instance.
// Re-auth on expiry or Code 2 error.

interface TokenCache {
  token: string;
  expiresAt: number;
}
let _tokenCache: TokenCache | null = null;

function clearTokenCache(): void {
  _tokenCache = null;
}

export function _resetTokenCacheForTests(): void {
  _tokenCache = null;
}

// ─── Typed error ──────────────────────────────────────────────────────────────

export class WebkassaApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly isRetryable: boolean,
    public readonly isDuplicate: boolean = false,
  ) {
    super(message);
    this.name = 'WebkassaApiError';
  }
}

export class WebkassaNetworkError extends Error {
  constructor(message: string, public readonly isRetryable: boolean = true) {
    super(message);
    this.name = 'WebkassaNetworkError';
  }
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function callApi<T>(
  config: WebkassaClientConfig,
  method: 'POST' | 'GET',
  path: string,
  body?: Record<string, unknown>,
  skipAuthInjection = false,
): Promise<T> {
  const url = `${config.apiBaseUrl}${path}`;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
    };

    let requestBody = body;

    // Inject token into body for authenticated calls (not for Authorize itself)
    if (!skipAuthInjection && _tokenCache && _tokenCache.expiresAt > Date.now()) {
      requestBody = { ...body, Token: _tokenCache.token };
    }

    const response = await fetch(url, {
      method,
      headers,
      body: requestBody !== undefined ? JSON.stringify(requestBody) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok && response.status !== 200) {
      // HTTP-level error (not Webkassa API error)
      let text = '';
      try { text = await response.text(); } catch { /* ignore */ }
      throw new WebkassaNetworkError(
        `HTTP ${response.status} from Webkassa ${path}: ${text.slice(0, 200)}`,
        response.status >= 500,
      );
    }

    let parsed: unknown;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json') || contentType.includes('text/json')) {
      try {
        parsed = await response.json();
      } catch {
        const text = await response.text();
        throw new WebkassaNetworkError(`Non-JSON response from Webkassa ${path}: ${text.slice(0, 200)}`, false);
      }
    } else {
      const text = await response.text();
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new WebkassaNetworkError(`Non-JSON response from Webkassa ${path}: ${text.slice(0, 200)}`, false);
      }
    }

    return parsed as T;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof WebkassaApiError || err instanceof WebkassaNetworkError) throw err;
    if ((err as { name?: string }).name === 'AbortError') {
      throw new WebkassaNetworkError(`Webkassa request timed out after ${timeoutMs}ms (${path})`, true);
    }
    throw new WebkassaNetworkError(`Network error calling Webkassa ${path}: ${(err as Error).message}`, true);
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function authenticate(config: WebkassaClientConfig): Promise<string> {
  const raw = await callApi<unknown>(config, 'POST', '/api/v4/Authorize', {
    Login: config.login,
    Password: config.password,
    // DO NOT log or expose config.password
  }, true /* skipAuthInjection */);

  const parsed = WebkassaAuthResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WebkassaNetworkError('Invalid auth response from Webkassa', false);
  }

  const { data: resp } = parsed;

  if (resp.Errors && resp.Errors.length > 0) {
    const firstAuthErr = resp.Errors[0]!;
    // Sanitize: do NOT include login/password in error log
    console.error('[webkassa/auth] auth failed with error code', firstAuthErr.Code);
    throw new WebkassaApiError(
      `Webkassa auth error ${firstAuthErr.Code}: ${firstAuthErr.Text}`,
      firstAuthErr.Code,
      false,
    );
  }

  const token = resp.Data?.Token;
  if (!token) {
    throw new WebkassaNetworkError('Webkassa auth response missing Token', false);
  }

  _tokenCache = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
  console.info('[webkassa/auth] authenticated, token cached (credentials not logged)');
  return token;
}

// ─── Ensure authenticated ──────────────────────────────────────────────────────

async function ensureToken(config: WebkassaClientConfig): Promise<string> {
  if (_tokenCache && _tokenCache.expiresAt > Date.now()) {
    return _tokenCache.token;
  }
  return authenticate(config);
}

// ─── Authenticated API call with re-auth on session expired ──────────────────

async function callAuthenticated<T>(
  config: WebkassaClientConfig,
  method: 'POST' | 'GET',
  path: string,
  body?: Record<string, unknown>,
  retryCount = 0,
): Promise<T> {
  const token = await ensureToken(config);
  const bodyWithToken = body ? { ...body, Token: token } : { Token: token };

  const raw = await callApi<T>(config, method, path, bodyWithToken, true);

  // Check for session expired — re-auth and retry once
  const asAny = raw as Record<string, unknown>;
  const errors = Array.isArray(asAny.Errors) ? asAny.Errors as Array<{ Code: number }> : [];
  const hasSessionExpired = errors.some((e) => e.Code === WEBKASSA_ERROR_CODES.SESSION_EXPIRED);

  if (hasSessionExpired && retryCount < 1) {
    console.info('[webkassa] session expired, re-authenticating');
    clearTokenCache();
    return callAuthenticated(config, method, path, body, retryCount + 1);
  }

  return raw;
}

// ─── API methods ──────────────────────────────────────────────────────────────

export async function getCashboxes(config: WebkassaClientConfig): Promise<WebkassaCashboxesResponseSchema> {
  const raw = await callAuthenticated<unknown>(config, 'POST', '/api/v4/Cashboxes', {});
  const parsed = WebkassaCashboxesResponseSchema.safeParse(raw);
  if (!parsed.success) throw new WebkassaNetworkError('Invalid cashboxes response', false);
  return parsed.data;
}

type WebkassaCashboxesResponseSchema = import('./webkassa-types').WebkassaCheckResponse;

export interface CreateCheckResult {
  checkNumber?: string;
  ticketUrl?: string;
  ticketPrintUrl?: string;
  shiftNumber?: number;
  total?: number;
  dateTimeUtc?: string;
  isDuplicate: boolean;
  rawData: WebkassaCheckData | null;
}

/**
 * Call POST /api/v4/check to fiscalize a receipt.
 *
 * ExternalCheckNumber is used for idempotency:
 * - On duplicate (Code 14), Webkassa returns existing receipt Data. We treat this as success.
 * - Pass the payment_transaction.id as ExternalCheckNumber to ensure one receipt per payment.
 */
export async function createCheck(
  config: WebkassaClientConfig,
  request: Omit<WebkassaCheckRequest, 'Token' | 'CashboxUniqueNumber'>,
  retryCount = 0,
): Promise<CreateCheckResult> {
  const fullRequest: Omit<WebkassaCheckRequest, 'Token'> = {
    ...request,
    CashboxUniqueNumber: config.cashboxUniqueNumber,
  };

  let raw: unknown;
  try {
    raw = await callAuthenticated<unknown>(config, 'POST', '/api/v4/check', fullRequest as Record<string, unknown>);
  } catch (err) {
    if (err instanceof WebkassaNetworkError && err.isRetryable && retryCount < MAX_RETRIES) {
      console.warn('[webkassa/check] retrying after transient error:', err.message);
      await sleep(1000 * (retryCount + 1));
      return createCheck(config, request, retryCount + 1);
    }
    throw err;
  }

  const parsed = WebkassaCheckResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WebkassaNetworkError('Invalid check response schema from Webkassa', false);
  }

  const resp = parsed.data;
  const errors = resp.Errors ?? [];
  const data = resp.Data ?? null;

  // Error 14 = duplicate ExternalCheckNumber → return existing receipt (idempotent success)
  if (errors.some((e) => e.Code === DUPLICATE_CHECK_CODE) && data) {
    console.info('[webkassa/check] duplicate ExternalCheckNumber — returning existing receipt', {
      checkNumber: data.CheckNumber,
      externalCheckNumber: request.ExternalCheckNumber,
    });
    return buildCheckResult(data, true);
  }

  // Other errors (no Data) = actual failure
  if (errors.length > 0 && !data) {
    const firstErr = errors[0]!;
    const isRetryable = RETRYABLE_ERROR_CODES.has(firstErr.Code as never);
    if (isRetryable && retryCount < MAX_RETRIES) {
      console.warn('[webkassa/check] retrying after error', firstErr.Code);
      await sleep(1000 * (retryCount + 1));
      return createCheck(config, request, retryCount + 1);
    }
    throw new WebkassaApiError(
      `Webkassa check error ${firstErr.Code}: ${firstErr.Text}`,
      firstErr.Code,
      isRetryable,
    );
  }

  if (!data) {
    throw new WebkassaNetworkError('Webkassa check response has no Data and no Errors', false);
  }

  console.info('[webkassa/check] receipt created', {
    checkNumber: data.CheckNumber,
    externalCheckNumber: request.ExternalCheckNumber,
    total: data.Total,
    operationType: request.OperationType,
  });

  return buildCheckResult(data, false);
}

// TicketUrl is a direct link to Webkassa's OFD receipt page — we store and display it as-is.
// /api/v4/Ticket/PrintFormat is not called: it is for custom receipt rendering, which we don't need.
function buildCheckResult(data: WebkassaCheckData, isDuplicate: boolean): CreateCheckResult {
  return {
    checkNumber: data.CheckNumber,
    ticketUrl: data.TicketUrl,
    ticketPrintUrl: data.TicketPrintUrl,
    shiftNumber: data.ShiftNumber,
    total: data.Total,
    dateTimeUtc: data.DateTimeUTC,
    isDuplicate,
    rawData: data,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Sanitize Webkassa response for storage. Strips token, password, API key.
 * Safe to store in fiscal_receipts.provider_response_sanitized.
 */
export function sanitizeForStorage(data: WebkassaCheckData | null): Record<string, unknown> | null {
  if (!data) return null;
  // data is already typed — no Token/Password fields. Cast to remove possible passthrough fields.
  const safe = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  // Belt-and-suspenders: remove any accidentally included fields
  delete safe['Token'];
  delete safe['Password'];
  return safe;
}

// ─── Z-report ─────────────────────────────────────────────────────────────────

export interface CreateZReportResult {
  shiftNumber?: number;
  openDate?: string;
  closeDate?: string;
  documentCount?: number;
  /** true when Webkassa returned code 12/13 (shift already closed) — idempotent success */
  alreadyClosed: boolean;
  rawData: WebkassaZReportData | null;
}

/**
 * Call POST /api/v4/ZReport to close the current shift.
 *
 * Idempotent: Webkassa error 12 (SHIFT_ALREADY_CLOSED) or 13 (NO_OPEN_SHIFT)
 * means the shift was already closed — treated as alreadyClosed=true (success).
 *
 * Note: Webkassa ZReport uses lowercase cashboxUniqueNumber (confirmed from Postman collection).
 */
export async function createZReport(config: WebkassaClientConfig): Promise<CreateZReportResult> {
  const raw = await callAuthenticated<unknown>(config, 'POST', '/api/v4/ZReport', {
    cashboxUniqueNumber: config.cashboxUniqueNumber,
  });

  const parsed = WebkassaZReportResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new WebkassaNetworkError('Invalid Z-report response schema from Webkassa', false);
  }

  const resp = parsed.data;
  const errors = resp.Errors ?? [];
  const data = resp.Data ?? null;

  // Code 12 or 13 = shift already closed — idempotent success
  const alreadyClosedError = errors.find((e) => Z_REPORT_ALREADY_DONE_CODES.has(e.Code as never));
  if (alreadyClosedError) {
    console.info('[webkassa/z-report] shift already closed (idempotent)', {
      code: alreadyClosedError.Code,
      cashboxUniqueNumber: config.cashboxUniqueNumber,
    });
    return { alreadyClosed: true, rawData: data };
  }

  // Other errors = actual failure
  if (errors.length > 0) {
    const firstErr = errors[0]!;
    const isRetryable = RETRYABLE_ERROR_CODES.has(firstErr.Code as never);
    throw new WebkassaApiError(
      `Webkassa Z-report error ${firstErr.Code}: ${firstErr.Text}`,
      firstErr.Code,
      isRetryable,
    );
  }

  if (!data) {
    throw new WebkassaNetworkError('Webkassa Z-report response has no Data and no Errors', false);
  }

  console.info('[webkassa/z-report] shift closed', {
    shiftNumber: data.ShiftNumber,
    documentCount: data.DocumentCount,
    cashboxUniqueNumber: config.cashboxUniqueNumber,
  });

  return {
    shiftNumber: data.ShiftNumber,
    openDate: data.OpenDate,
    closeDate: data.CloseDate,
    documentCount: data.DocumentCount,
    alreadyClosed: false,
    rawData: data,
  };
}
