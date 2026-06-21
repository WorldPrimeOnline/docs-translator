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
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus?: number,
    public readonly responseBodySnippet?: string,
  ) {
    super(message);
    this.name = 'HalykApiError';
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function withTimeout(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  const { signal: timeoutSignal, ...rest } = init as RequestInit & { signal?: AbortSignal };
  const response = await fetch(url, {
    ...rest,
    signal: timeoutSignal ?? withTimeout(FETCH_TIMEOUT_MS),
  });
  return response;
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new HalykApiError(
      `Halyk returned non-JSON response (HTTP ${response.status})`,
      'parse_error',
      response.status,
    );
  }
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
    throw new HalykApiError('Halyk ePay is not enabled', 'disabled');
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'webapi usermanagement email_send verification statement statistics payment',
    client_id: config.clientId,
    client_secret: config.clientSecret,
    invoiceID: params.invoiceId,
    secret_hash: params.secretHash,
    amount: String(params.amount),
    currency: 'KZT',
    terminal: config.terminalId,
    postLink: params.postLink,
    failurePostLink: params.failurePostLink,
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await safeFetch(config.endpoints.oauthUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });

      if (!response.ok) {
        let bodySnippet = '';
        try { bodySnippet = (await response.text()).slice(0, 300); } catch { /* ignore */ }
        throw new HalykApiError(
          `Halyk OAuth HTTP ${response.status}`,
          'oauth_http_error',
          response.status,
          bodySnippet,
        );
      }

      const raw = await parseJsonSafe(response);
      const parsed = HalykTokenResponseSchema.safeParse(raw);

      if (!parsed.success) {
        throw new HalykApiError(
          'Halyk OAuth response validation failed',
          'oauth_parse_error',
        );
      }

      return parsed.data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // Only retry on network/timeout errors, not on HTTP 4xx
      if (err instanceof HalykApiError && err.httpStatus && err.httpStatus < 500) {
        break;
      }
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new HalykApiError('Unknown Halyk OAuth error', 'unknown');
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
    throw new HalykApiError('Halyk ePay is not enabled', 'disabled');
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
      throw new HalykApiError(
        `Halyk status-token HTTP ${tokenResp.status}`,
        'status_token_error',
        tokenResp.status,
      );
    }

    const tokenRaw = await parseJsonSafe(tokenResp);
    const tokenParsed = HalykTokenResponseSchema.safeParse(tokenRaw);
    if (!tokenParsed.success) {
      throw new HalykApiError('Halyk status token parse error', 'status_token_parse');
    }
    accessToken = tokenParsed.data.access_token;
  } catch (err) {
    if (err instanceof HalykApiError) throw err;
    throw new HalykApiError(
      'Failed to obtain Halyk status token',
      'status_token_fetch',
    );
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
        throw new HalykApiError(
          `Halyk status API HTTP ${response.status}`,
          'status_http_error',
          response.status,
        );
      }

      const raw = await parseJsonSafe(response);
      const parsed = HalykStatusResponseSchema.safeParse(raw);

      if (!parsed.success) {
        throw new HalykApiError(
          'Halyk status response validation failed',
          'status_parse_error',
        );
      }

      return parsed.data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (err instanceof HalykApiError && err.httpStatus && err.httpStatus < 500) break;
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new HalykApiError('Unknown Halyk status error', 'unknown');
}
