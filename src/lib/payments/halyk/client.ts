/**
 * Halyk ePay API client — server-only module.
 * Handles OAuth token acquisition and payment status checks.
 * Never imports this from client-side code.
 */
import { getHalykConfig } from './config';
import {
  HalykTokenResponseSchema,
  HalykStatusResponseSchema,
  type HalykTokenResponse,
  type HalykStatusResponse,
} from './types';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

// ─── Typed errors ──────────────────────────────────────────────────────────────

export class HalykApiError extends Error {
  readonly code: string;
  readonly httpStatus?: number;
  readonly responseBodySnippet?: string;
  readonly responseContentType?: string;
  readonly halykErrorCode?: string;
  readonly halykErrorDescription?: string;
  readonly validationIssues?: Array<{ path: (string | number)[]; message: string }>;

  constructor(params: {
    message?: string;
    code: string;
    httpStatus?: number;
    responseBodySnippet?: string;
    responseContentType?: string;
    halykErrorCode?: string;
    halykErrorDescription?: string;
    validationIssues?: Array<{ path: (string | number)[]; message: string }>;
  }) {
    super(params.message ?? params.code);
    this.name = 'HalykApiError';
    this.code = params.code;
    this.httpStatus = params.httpStatus;
    this.responseBodySnippet = params.responseBodySnippet;
    this.responseContentType = params.responseContentType;
    this.halykErrorCode = params.halykErrorCode;
    this.halykErrorDescription = params.halykErrorDescription;
    this.validationIssues = params.validationIssues;
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  const { signal: timeoutSignal, ...rest } = init as RequestInit & { signal?: AbortSignal };
  return fetch(url, {
    ...rest,
    signal: timeoutSignal ?? withTimeout(FETCH_TIMEOUT_MS),
  });
}

/**
 * Reads the response body exactly once and returns both the raw text and parsed
 * JSON. Callers must NOT call response.text() or response.json() after this.
 *
 * Throws HalykApiError with code HALYK_OAUTH_NON_JSON_RESPONSE on parse failure.
 */
async function parseJsonResponse(response: Response): Promise<{
  data: unknown;
  rawText: string;
  httpStatus: number;
  contentType: string;
}> {
  const httpStatus = response.status;
  const contentType = response.headers.get('content-type') ?? '';
  const rawText = await response.text();

  try {
    const data = JSON.parse(rawText);
    return { data, rawText, httpStatus, contentType };
  } catch {
    throw new HalykApiError({
      message: `Halyk returned non-JSON response (HTTP ${httpStatus})`,
      code: 'HALYK_OAUTH_NON_JSON_RESPONSE',
      httpStatus,
      responseBodySnippet: rawText.slice(0, 500),
      responseContentType: contentType,
    });
  }
}

/** Redact access_token from a raw response text snippet for safe logging. */
function redactSnippet(rawText: string): string {
  return rawText
    .replace(/"access_token"\s*:\s*"[^"]+"/g, '"access_token":"[REDACTED]"')
    .slice(0, 500);
}

// ─── Token acquisition ─────────────────────────────────────────────────────────

export interface PaymentTokenParams {
  invoiceId: string;
  secretHash: string;
  amount: number;
  postLink: string;
  failurePostLink: string;
}

/**
 * Obtains a payment-scoped OAuth token from Halyk.
 * Each payment attempt must request its own token — never reuse across attempts.
 * client_secret is used here and never returned to the caller.
 */
export async function createPaymentToken(params: PaymentTokenParams): Promise<HalykTokenResponse> {
  const config = getHalykConfig();

  if (!config.enabled) {
    throw new HalykApiError({ message: 'Halyk ePay is not enabled', code: 'HALYK_DISABLED' });
  }

  // Halyk expects URLSearchParams with these exact field names (invoiceID, terminal).
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'webapi usermanagement email_send verification statement statistics payment',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    invoiceID: params.invoiceId,     // Halyk requires uppercase ID
    secret_hash: params.secretHash,
    amount: String(Math.round(params.amount)), // integer KZT, no decimal point
    currency: 'KZT',
    terminal: config.terminalId,     // Halyk requires 'terminal', not 'terminalId'
    postLink: params.postLink,
    failurePostLink: params.failurePostLink,
  });

  // Log request field presence for diagnostics (never log values of secrets)
  console.log('[halyk/client] oauth request fields', {
    hasGrantType: body.has('grant_type'),
    hasScope: body.has('scope'),
    hasClientId: body.has('client_id'),
    hasClientSecret: body.has('client_secret'),
    hasInvoiceID: body.has('invoiceID'),
    hasSecretHash: body.has('secret_hash'),
    hasAmount: body.has('amount'),
    hasCurrency: body.has('currency'),
    hasTerminal: body.has('terminal'),
    hasPostLink: body.has('postLink'),
    hasFailurePostLink: body.has('failurePostLink'),
    amount: body.get('amount'),
    currency: body.get('currency'),
    terminalMasked: String(body.get('terminal') ?? '').slice(0, 4) + '****',
    postLinkHost: params.postLink ? (() => { try { return new URL(params.postLink).hostname; } catch { return null; } })() : null,
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await safeFetch(config.endpoints.oauthUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      // Capture status and body before any throwing — body can only be read once.
      const httpStatus = response.status;
      const contentType = response.headers.get('content-type') ?? '';

      if (!response.ok) {
        const rawBody = await response.text().catch(() => '');
        let errorBody: Record<string, unknown> = {};
        try { errorBody = JSON.parse(rawBody) as Record<string, unknown>; } catch { /* not JSON */ }
        throw new HalykApiError({
          message: `Halyk OAuth HTTP ${httpStatus}`,
          code: 'HALYK_OAUTH_HTTP_ERROR',
          httpStatus,
          responseBodySnippet: rawBody.slice(0, 500),
          responseContentType: contentType,
          halykErrorCode: typeof errorBody.error === 'string' ? errorBody.error : undefined,
          halykErrorDescription: typeof errorBody.error_description === 'string' ? errorBody.error_description : undefined,
        });
      }

      // Read and parse body — parseJsonResponse consumes the stream exactly once.
      const { data: raw, rawText, httpStatus: okStatus, contentType: okContentType } = await parseJsonResponse(response);
      const snippet = redactSnippet(rawText);

      // Token field normalization: some Halyk environments may use 'token' instead of 'access_token'.
      const rawRecord = raw as Record<string, unknown>;
      if (!rawRecord.access_token && typeof rawRecord.token === 'string') {
        rawRecord.access_token = rawRecord.token;
      }

      const parsed = HalykTokenResponseSchema.safeParse(rawRecord);
      if (!parsed.success) {
        throw new HalykApiError({
          message: 'Halyk OAuth response validation failed',
          code: 'HALYK_OAUTH_SCHEMA_ERROR',
          httpStatus: okStatus,
          responseBodySnippet: snippet,
          responseContentType: okContentType,
          validationIssues: parsed.error.issues.map((i) => ({
            path: i.path as (string | number)[],
            message: i.message,
          })),
        });
      }

      if (!parsed.data.access_token) {
        throw new HalykApiError({
          message: 'Halyk OAuth returned empty access_token',
          code: 'HALYK_OAUTH_EMPTY_TOKEN',
          httpStatus: okStatus,
          responseBodySnippet: snippet,
          responseContentType: okContentType,
        });
      }

      return parsed.data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Do not retry on 4xx client errors or schema errors — retrying won't help.
      if (err instanceof HalykApiError) {
        const skipRetry =
          (err.httpStatus !== undefined && err.httpStatus < 500) ||
          err.code === 'HALYK_OAUTH_SCHEMA_ERROR' ||
          err.code === 'HALYK_OAUTH_EMPTY_TOKEN' ||
          err.code === 'HALYK_DISABLED';
        if (skipRetry) break;
      }
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new HalykApiError({ message: 'Unknown Halyk OAuth error', code: 'HALYK_UNKNOWN' });
}

// ─── Status check ─────────────────────────────────────────────────────────────

/**
 * Checks the authoritative payment status from Halyk.
 * Acquires a separate client-credentials token (no invoiceID, no secret_hash).
 * Returns the full status response; caller is responsible for mapping.
 */
export async function checkPaymentStatus(invoiceId: string): Promise<HalykStatusResponse> {
  const config = getHalykConfig();

  if (!config.enabled) {
    throw new HalykApiError({ message: 'Halyk ePay is not enabled', code: 'HALYK_DISABLED' });
  }

  // Get a status-only client-credentials token (no payment-specific fields)
  const tokenBody = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'webapi usermanagement email_send verification statement statistics payment',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    terminal: config.terminalId,
  });

  let accessToken: string;

  try {
    const tokenResp = await safeFetch(config.endpoints.oauthUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });

    if (!tokenResp.ok) {
      throw new HalykApiError({
        message: `Halyk status-token HTTP ${tokenResp.status}`,
        code: 'HALYK_STATUS_TOKEN_ERROR',
        httpStatus: tokenResp.status,
      });
    }

    const { data: tokenRaw, rawText: tokenRawText, httpStatus: tokenStatus, contentType: tokenContentType } = await parseJsonResponse(tokenResp);

    // Normalize 'token' → 'access_token' if needed
    const tokenRecord = tokenRaw as Record<string, unknown>;
    if (!tokenRecord.access_token && typeof tokenRecord.token === 'string') {
      tokenRecord.access_token = tokenRecord.token;
    }

    const tokenParsed = HalykTokenResponseSchema.safeParse(tokenRecord);
    if (!tokenParsed.success) {
      throw new HalykApiError({
        message: 'Halyk status token parse error',
        code: 'HALYK_STATUS_TOKEN_PARSE',
        httpStatus: tokenStatus,
        responseBodySnippet: redactSnippet(tokenRawText),
        responseContentType: tokenContentType,
      });
    }
    accessToken = tokenParsed.data.access_token;
  } catch (err) {
    if (err instanceof HalykApiError) throw err;
    throw new HalykApiError({
      message: 'Failed to obtain Halyk status token',
      code: 'HALYK_STATUS_TOKEN_FETCH',
    });
  }

  // Fetch transaction status
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const url = `${config.endpoints.apiBase}/check-status/payment/transaction/${encodeURIComponent(invoiceId)}`;
      const response = await safeFetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new HalykApiError({
          message: `Halyk status API HTTP ${response.status}`,
          code: 'HALYK_STATUS_HTTP_ERROR',
          httpStatus: response.status,
        });
      }

      const { data: raw, rawText, httpStatus: statusCode, contentType } = await parseJsonResponse(response);
      const parsed = HalykStatusResponseSchema.safeParse(raw);

      if (!parsed.success) {
        throw new HalykApiError({
          message: 'Halyk status response validation failed',
          code: 'HALYK_STATUS_PARSE_ERROR',
          httpStatus: statusCode,
          responseBodySnippet: rawText.slice(0, 500),
          responseContentType: contentType,
        });
      }

      return parsed.data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (err instanceof HalykApiError && err.httpStatus !== undefined && err.httpStatus < 500) break;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new HalykApiError({ message: 'Unknown Halyk status error', code: 'HALYK_STATUS_UNKNOWN' });
}
