/**
 * Webkassa HTTP client — worker-side copy.
 * Canonical version: src/lib/fiscal/webkassa-client.ts
 * Keep in sync manually.
 *
 * Differences from canonical:
 * - Adds createZReport() (also added to canonical)
 * - No getCashboxes() (not needed in worker)
 * - Uses zod from worker's own node_modules
 */

import { z } from 'zod';

// ─── Schemas (inline to avoid cross-project imports) ──────────────────────────

const WebkassaErrorSchema = z.object({ Code: z.number(), Text: z.string() });

const WebkassaAuthResponseSchema = z.object({
  Data: z.object({ Token: z.string().optional() }).optional().nullable(),
  Errors: z.array(WebkassaErrorSchema).optional().nullable(),
});

const WebkassaCheckDataSchema = z.object({
  CheckNumber: z.string().optional(),
  DateTimeUTC: z.string().optional(),
  ShiftNumber: z.number().optional(),
  Total: z.number().optional(),
  TicketUrl: z.string().optional(),
  TicketPrintUrl: z.string().optional(),
}).passthrough();

const WebkassaCheckResponseSchema = z.object({
  Data: WebkassaCheckDataSchema.optional().nullable(),
  Errors: z.array(WebkassaErrorSchema).optional().nullable(),
});

const WebkassaZReportDataSchema = z.object({
  ShiftNumber: z.number().optional(),
  OpenDate: z.string().optional(),
  CloseDate: z.string().optional(),
  DocumentCount: z.number().optional(),
  FirstDocumentNumber: z.number().optional(),
  LastDocumentNumber: z.number().optional(),
}).passthrough();

const WebkassaZReportResponseSchema = z.object({
  Data: WebkassaZReportDataSchema.optional().nullable(),
  Errors: z.array(WebkassaErrorSchema).optional().nullable(),
});

export type WebkassaCheckData = z.infer<typeof WebkassaCheckDataSchema>;
export type WebkassaZReportData = z.infer<typeof WebkassaZReportDataSchema>;

// ─── Error codes ──────────────────────────────────────────────────────────────

const ERROR_CODES = {
  SESSION_EXPIRED: 2,
  SHIFT_OVER_24H: 11,
  SHIFT_ALREADY_CLOSED: 12,
  NO_OPEN_SHIFT: 13,
  DUPLICATE_EXTERNAL_NUMBER: 14,
  SERVICE_UNAVAILABLE: 505,
  UNKNOWN: -1,
} as const;

export const WEBKASSA_ERROR_SHIFT_OVER_24H = ERROR_CODES.SHIFT_OVER_24H;

const RETRYABLE_CODES = new Set([ERROR_CODES.SERVICE_UNAVAILABLE, ERROR_CODES.UNKNOWN]);
const Z_REPORT_ALREADY_DONE = new Set([ERROR_CODES.SHIFT_ALREADY_CLOSED, ERROR_CODES.NO_OPEN_SHIFT]);

// ─── Config ───────────────────────────────────────────────────────────────────

export interface WebkassaConfig {
  apiBaseUrl: string;
  apiKey: string;
  login: string;
  password: string;
  cashboxUniqueNumber: string;
  timeoutMs?: number;
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export class WebkassaApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly isRetryable: boolean,
    public readonly isDuplicate = false,
  ) {
    super(message);
    this.name = 'WebkassaApiError';
  }
}

export class WebkassaNetworkError extends Error {
  constructor(message: string, public readonly isRetryable = true) {
    super(message);
    this.name = 'WebkassaNetworkError';
  }
}

// ─── Token cache ──────────────────────────────────────────────────────────────

const TOKEN_TTL_MS = 22 * 60 * 60 * 1000; // 22h
interface TokenCache { token: string; expiresAt: number }
let _tokenCache: TokenCache | null = null;

export function _resetTokenCacheForTests(): void { _tokenCache = null; }

// ─── HTTP ─────────────────────────────────────────────────────────────────────

async function callApi<T>(
  cfg: WebkassaConfig,
  method: 'POST' | 'GET',
  path: string,
  body?: Record<string, unknown>,
  skipAuthInjection = false,
): Promise<T> {
  const url = `${cfg.apiBaseUrl}${path}`;
  const timeoutMs = cfg.timeoutMs ?? 30_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let requestBody = body;
    if (!skipAuthInjection && _tokenCache && _tokenCache.expiresAt > Date.now()) {
      requestBody = { ...body, Token: _tokenCache.token };
    }

    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey },
      body: requestBody !== undefined ? JSON.stringify(requestBody) : undefined,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      let text = '';
      try { text = await response.text(); } catch { /* ignore */ }
      const isServerError = response.status >= 500;
      console.error('[webkassa/worker] HTTP error', {
        status: response.status,
        path,
        host: (() => { try { return new URL(url).hostname; } catch { return url; } })(),
        responseText: text.slice(0, 300),
      });
      throw new WebkassaNetworkError(
        `HTTP ${response.status} from Webkassa ${path}: ${text.slice(0, 200)}`,
        isServerError,
      );
    }

    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new WebkassaNetworkError(`Non-JSON response from Webkassa ${path}: ${text.slice(0, 200)}`, false);
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof WebkassaApiError || err instanceof WebkassaNetworkError) throw err;
    if ((err as { name?: string }).name === 'AbortError') {
      throw new WebkassaNetworkError(`Webkassa request timed out after ${timeoutMs}ms (${path})`, true);
    }
    throw new WebkassaNetworkError(`Network error calling Webkassa ${path}: ${(err as Error).message}`, true);
  }
}

async function authenticate(cfg: WebkassaConfig): Promise<string> {
  const host = (() => { try { return new URL(cfg.apiBaseUrl).hostname; } catch { return cfg.apiBaseUrl; } })();
  const loginDomain = cfg.login.includes('@') ? cfg.login.split('@')[1] : '(no-domain)';
  console.info('[webkassa/worker] authorize started', {
    host,
    path: '/api/v4/Authorize',
    hasApiKey: !!cfg.apiKey,
    apiKeyLength: cfg.apiKey.length,
    hasLogin: !!cfg.login,
    loginDomain,          // only domain portion, never full login
    hasPassword: !!cfg.password,
    cashboxUniqueNumber: cfg.cashboxUniqueNumber,
  });

  const raw = await callApi<unknown>(cfg, 'POST', '/api/v4/Authorize', {
    Login: cfg.login,
    Password: cfg.password,
  }, true);

  const parsed = WebkassaAuthResponseSchema.safeParse(raw);
  if (!parsed.success) throw new WebkassaNetworkError('Invalid auth response from Webkassa', false);

  const { data: resp } = parsed;
  if (resp.Errors?.length) {
    const e = resp.Errors[0]!;
    console.error('[webkassa/worker] auth failed', {
      code: e.Code,
      text: e.Text,
      host,
      cashboxUniqueNumber: cfg.cashboxUniqueNumber,
      loginDomain,
      hasApiKey: !!cfg.apiKey,
      apiKeyLength: cfg.apiKey.length,
      // Never log: apiKey value, login, password
    });
    throw new WebkassaApiError(`Webkassa auth error ${e.Code}: ${e.Text}`, e.Code, false);
  }

  const token = resp.Data?.Token;
  if (!token) throw new WebkassaNetworkError('Webkassa auth response missing Token', false);

  _tokenCache = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
  console.info('[webkassa/worker] authenticated (credentials not logged)');
  return token;
}

async function ensureToken(cfg: WebkassaConfig): Promise<string> {
  if (_tokenCache && _tokenCache.expiresAt > Date.now()) return _tokenCache.token;
  return authenticate(cfg);
}

async function callAuthenticated<T>(
  cfg: WebkassaConfig,
  method: 'POST' | 'GET',
  path: string,
  body?: Record<string, unknown>,
  retryCount = 0,
): Promise<T> {
  const token = await ensureToken(cfg);
  const raw = await callApi<T>(cfg, method, path, { ...body, Token: token }, true);

  // Re-auth on session expired
  const asAny = raw as Record<string, unknown>;
  const errors = Array.isArray(asAny.Errors) ? asAny.Errors as Array<{ Code: number }> : [];
  if (errors.some((e) => e.Code === ERROR_CODES.SESSION_EXPIRED) && retryCount < 1) {
    console.info('[webkassa/worker] session expired, re-authenticating');
    _tokenCache = null;
    return callAuthenticated<T>(cfg, method, path, body, retryCount + 1);
  }

  return raw;
}

// ─── Check (receipt) ──────────────────────────────────────────────────────────

export interface WebkassaCheckRequest {
  OperationType: 0 | 1 | 2 | 3;
  Positions: {
    Count: number;
    Price: number;
    TaxPercent: number;
    Tax: number;
    TaxType: 0 | 100;
    PositionName: string;
    PositionCode?: string;
    Discount?: number;
    Markup?: number;
    UnitCode: number;
  }[];
  Payments: { Sum: number; PaymentType: 0 | 1 | 4 }[];
  Change: number;
  RoundType: number;
  ExternalCheckNumber: string;
  ExternalOrderNumber?: string;
  CustomerEmail?: string;
  ExternalLinkId?: string;
  /**
   * For OperationType=3 (SALE_RETURN): ExternalCheckNumber of the original sale receipt.
   * Value = payment_transaction_id of the original payment (same as original sale's ExternalCheckNumber).
   */
  OriginalExternalCheckNumber?: string;
  /**
   * Required for OperationType=3 (SALE_RETURN) per Webkassa protocol 2.0.3+.
   * Contains fields from the original sale response to link the return to its basis.
   * dateTime: "YYYY-MM-DD HH:mm:ss" (converted from Webkassa "DD.MM.YYYY HH:mm:ss")
   * total: original sale Total in KZT
   * checkNumber: Webkassa-assigned CheckNumber from original sale
   * registrationNumber: cashbox RegistrationNumber (12 digits)
   * isOffline: original sale OfflineMode flag
   */
  returnBasisDetails?: {
    dateTime: string;
    total: number;
    checkNumber: string;
    registrationNumber: string;
    isOffline: boolean;
  };
}

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

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

export async function createCheck(
  cfg: WebkassaConfig,
  request: WebkassaCheckRequest,
  retryCount = 0,
): Promise<CreateCheckResult> {
  let raw: unknown;
  try {
    raw = await callAuthenticated<unknown>(cfg, 'POST', '/api/v4/check', {
      ...request,
      CashboxUniqueNumber: cfg.cashboxUniqueNumber,
    });
  } catch (err) {
    if (err instanceof WebkassaNetworkError && err.isRetryable && retryCount < 1) {
      console.warn('[webkassa/worker] retrying check after transient error:', (err as Error).message);
      await sleep(1000 * (retryCount + 1));
      return createCheck(cfg, request, retryCount + 1);
    }
    throw err;
  }

  const parsed = WebkassaCheckResponseSchema.safeParse(raw);
  if (!parsed.success) throw new WebkassaNetworkError('Invalid check response schema', false);

  const resp = parsed.data;
  const errors = resp.Errors ?? [];
  const data = resp.Data ?? null;

  // Error 14 = duplicate ExternalCheckNumber → idempotent success
  if (errors.some((e) => e.Code === ERROR_CODES.DUPLICATE_EXTERNAL_NUMBER) && data) {
    console.info('[webkassa/worker] duplicate ExternalCheckNumber — returning existing receipt', {
      checkNumber: data.CheckNumber,
      externalCheckNumber: request.ExternalCheckNumber,
    });
    return buildCheckResult(data, true);
  }

  if (errors.length > 0 && !data) {
    const firstErr = errors[0]!;
    const isRetryable = RETRYABLE_CODES.has(firstErr.Code as never);
    if (isRetryable && retryCount < 1) {
      console.warn('[webkassa/worker] retrying check after error', firstErr.Code);
      await sleep(1000 * (retryCount + 1));
      return createCheck(cfg, request, retryCount + 1);
    }
    throw new WebkassaApiError(
      `Webkassa check error ${firstErr.Code}: ${firstErr.Text}`,
      firstErr.Code,
      isRetryable,
      false,
    );
  }

  if (!data) throw new WebkassaNetworkError('Webkassa check response has no Data and no Errors', false);

  console.info('[webkassa/worker] receipt created', {
    checkNumber: data.CheckNumber,
    operationType: request.OperationType,
    externalCheckNumber: request.ExternalCheckNumber,
    total: data.Total,
  });

  return buildCheckResult(data, false);
}

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

// ─── Z-report ─────────────────────────────────────────────────────────────────

export interface CreateZReportResult {
  shiftNumber?: number;
  openDate?: string;
  closeDate?: string;
  documentCount?: number;
  /** true when Webkassa returned code 12/13 — shift already closed (idempotent success) */
  alreadyClosed: boolean;
  rawData: WebkassaZReportData | null;
}

/**
 * POST /api/v4/ZReport — close current shift.
 *
 * Idempotent: errors 12/13 (shift already closed / no open shift) treated as success.
 * Note: ZReport uses lowercase cashboxUniqueNumber (verified from Webkassa Postman collection).
 */
export async function createZReport(cfg: WebkassaConfig): Promise<CreateZReportResult> {
  const raw = await callAuthenticated<unknown>(cfg, 'POST', '/api/v4/ZReport', {
    cashboxUniqueNumber: cfg.cashboxUniqueNumber,
  });

  const parsed = WebkassaZReportResponseSchema.safeParse(raw);
  if (!parsed.success) throw new WebkassaNetworkError('Invalid Z-report response schema', false);

  const resp = parsed.data;
  const errors = resp.Errors ?? [];
  const data = resp.Data ?? null;

  const alreadyDoneError = errors.find((e) => Z_REPORT_ALREADY_DONE.has(e.Code as never));
  if (alreadyDoneError) {
    console.info('[webkassa/worker] Z-report: shift already closed', {
      code: alreadyDoneError.Code,
      cashboxUniqueNumber: cfg.cashboxUniqueNumber,
    });
    return { alreadyClosed: true, rawData: data };
  }

  if (errors.length > 0) {
    const firstErr = errors[0]!;
    const isRetryable = RETRYABLE_CODES.has(firstErr.Code as never);
    throw new WebkassaApiError(
      `Webkassa Z-report error ${firstErr.Code}: ${firstErr.Text}`,
      firstErr.Code,
      isRetryable,
    );
  }

  if (!data) throw new WebkassaNetworkError('Webkassa Z-report response has no Data and no Errors', false);

  console.info('[webkassa/worker] Z-report: shift closed', {
    shiftNumber: data.ShiftNumber,
    documentCount: data.DocumentCount,
    closeDate: data.CloseDate,
    cashboxUniqueNumber: cfg.cashboxUniqueNumber,
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

// ─── Sanitize ─────────────────────────────────────────────────────────────────

export function sanitizeForStorage(data: WebkassaCheckData | WebkassaZReportData | null): Record<string, unknown> | null {
  if (!data) return null;
  const safe = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
  delete safe['Token'];
  delete safe['Password'];
  return safe;
}
