/**
 * Webkassa fiscal provider implementation.
 * Server-side only.
 *
 * Safety gates (checked before any HTTP call):
 * 1. WEBKASSA_ENABLED !== 'true' → pending_manual (config off)
 * 2. FISCAL_PROVIDER_ENV=production + WEBKASSA_ALLOW_REAL_RECEIPTS !== 'true' → blocked_by_config
 * 3. Missing required credentials → pending_manual with error log
 *
 * None of these failures affect the payment/job flow.
 *
 * Auth flow (per Webkassa API v4):
 *   POST /api/v4/Authorize { Login, Password } with header x-api-key
 *   → { Data: { Token } }
 *   Token is passed in body of all subsequent requests.
 *   Token cached up to 22h. Re-auth on Error 2 (session expired).
 *
 * Receipt flow:
 *   POST /api/v4/check with OperationType=2 (sale) or 3 (sale_return)
 *   ExternalCheckNumber = payment_transaction.id for idempotency
 *   Error 14 = duplicate ExternalCheckNumber → return existing receipt (not a failure)
 */

import type { FiscalProvider, FiscalSaleInput, FiscalRefundInput, FiscalReceiptResult } from './types';
import {
  createCheck,
  sanitizeForStorage,
  WebkassaApiError,
  WebkassaNetworkError,
} from './webkassa-client';
import {
  WEBKASSA_OPERATION_TYPES,
  WEBKASSA_PAYMENT_TYPES,
} from './webkassa-types';
import type { WebkassaClientConfig } from './webkassa-client';

// ─── Config reading ────────────────────────────────────────────────────────────

export interface WebkassaProviderConfig {
  enabled: boolean;
  apiBaseUrl: string;
  apiKey: string;
  login: string;
  password: string;
  cashboxUniqueNumber: string;
  providerEnvironment: 'test' | 'production';
  allowRealReceipts: boolean;
  /** TaxType: 0 = no tax (без НДС), 100 = VAT (НДС). Confirm with accountant. Default: 0 */
  taxType: 0 | 100;
  /** TaxPercent: only used when taxType=100. Default: 0 */
  taxPercent: number;
  /** UnitCode: 796 = шт (piece). Webkassa reference: POST /api/v4/references/RefUnits */
  unitCode: number;
  /** RoundType: 2 as per Webkassa examples */
  roundType: number;
  /** Service name for receipt positions */
  serviceName: string;
  serviceNameOfficial: string;
  serviceNameNotarized: string;
}

const TEST_BASE_URL = 'https://devkkm.webkassa.kz';
// Production URL: confirm with Webkassa — set via WEBKASSA_API_BASE_URL
// Commonly: https://kkm.webkassa.kz (not confirmed in collection, collection only shows test)

let _config: WebkassaProviderConfig | null = null;

export function getWebkassaProviderConfig(): WebkassaProviderConfig {
  if (_config) return _config;

  const providerEnv = process.env.FISCAL_PROVIDER_ENV === 'production' ? 'production' : 'test';
  const enabled = process.env.WEBKASSA_ENABLED === 'true';
  const allowReal = process.env.WEBKASSA_ALLOW_REAL_RECEIPTS === 'true';

  _config = {
    enabled,
    apiBaseUrl: (process.env.WEBKASSA_API_BASE_URL ?? TEST_BASE_URL).replace(/\/$/, ''),
    apiKey: process.env.WEBKASSA_API_KEY ?? '',
    login: process.env.WEBKASSA_LOGIN ?? '',
    password: process.env.WEBKASSA_PASSWORD ?? '',
    cashboxUniqueNumber: process.env.WEBKASSA_CASHBOX_SERIAL_NUMBER ?? '',
    providerEnvironment: providerEnv,
    allowRealReceipts: allowReal,
    taxType: process.env.WEBKASSA_TAX_TYPE === '100' ? 100 : 0,
    taxPercent: process.env.WEBKASSA_TAX_TYPE === '100' ? 12 : 0,  // KZ VAT = 12%
    unitCode: 796,  // шт (piece) — standard for services
    roundType: 2,
    serviceName: process.env.WEBKASSA_SERVICE_NAME ?? 'Услуга перевода документа',
    serviceNameOfficial: process.env.WEBKASSA_SERVICE_NAME_OFFICIAL ?? 'Услуга официального перевода документа',
    serviceNameNotarized: process.env.WEBKASSA_SERVICE_NAME_NOTARIZED ?? 'Услуга перевода документа с нотариальным удостоверением',
  };

  return _config;
}

export function _resetWebkassaConfigCache(): void {
  _config = null;
}

// ─── Safety check ────────────────────────────────────────────────────────────

interface SafetyCheckResult {
  blocked: boolean;
  reason?: string;
  fallbackStatus: 'pending_manual' | 'blocked_by_config';
}

function checkSafetyGates(cfg: WebkassaProviderConfig): SafetyCheckResult {
  if (!cfg.enabled) {
    return { blocked: true, reason: 'WEBKASSA_ENABLED is not true', fallbackStatus: 'pending_manual' };
  }
  if (!cfg.apiKey || !cfg.login || !cfg.password || !cfg.cashboxUniqueNumber) {
    const missing = [
      !cfg.apiKey && 'WEBKASSA_API_KEY',
      !cfg.login && 'WEBKASSA_LOGIN',
      !cfg.password && 'WEBKASSA_PASSWORD',
      !cfg.cashboxUniqueNumber && 'WEBKASSA_CASHBOX_SERIAL_NUMBER',
    ].filter(Boolean).join(', ');
    return { blocked: true, reason: `Missing credentials: ${missing}`, fallbackStatus: 'pending_manual' };
  }
  if (cfg.providerEnvironment === 'production' && !cfg.allowRealReceipts) {
    return {
      blocked: true,
      reason: 'WEBKASSA_ALLOW_REAL_RECEIPTS is not true for production environment',
      fallbackStatus: 'blocked_by_config',
    };
  }
  return { blocked: false, fallbackStatus: 'pending_manual' };
}

// ─── Provider ────────────────────────────────────────────────────────────────

export class WebkassaFiscalProvider implements FiscalProvider {
  readonly name = 'webkassa';

  private getClientConfig(cfg: WebkassaProviderConfig): WebkassaClientConfig {
    return {
      apiBaseUrl: cfg.apiBaseUrl,
      apiKey: cfg.apiKey,
      login: cfg.login,
      password: cfg.password,  // Never logged by client
      cashboxUniqueNumber: cfg.cashboxUniqueNumber,
      timeoutMs: 30_000,
    };
  }

  private resolveServiceName(
    cfg: WebkassaProviderConfig,
    description?: string,
  ): string {
    if (description?.includes('официальн')) return cfg.serviceNameOfficial;
    if (description?.includes('нотариальн')) return cfg.serviceNameNotarized;
    return cfg.serviceName;
  }

  async createSaleReceipt(input: FiscalSaleInput): Promise<FiscalReceiptResult> {
    const cfg = getWebkassaProviderConfig();
    const safety = checkSafetyGates(cfg);

    if (safety.blocked) {
      console.info('[webkassa/provider] sale receipt blocked by config', {
        reason: safety.reason,
        jobId: input.jobId,
        paymentTransactionId: input.paymentTransactionId,
      });
      return {
        status: safety.fallbackStatus,
        providerResponseSanitized: { provider: 'webkassa', blocked: true, reason: safety.reason },
      };
    }

    const serviceName = this.resolveServiceName(cfg, input.description);
    const amountKzt = input.amountKzt;
    const taxAmount = cfg.taxType === 100 ? +(amountKzt - amountKzt / (1 + cfg.taxPercent / 100)).toFixed(2) : 0;

    const clientConfig = this.getClientConfig(cfg);

    try {
      const result = await createCheck(clientConfig, {
        OperationType: WEBKASSA_OPERATION_TYPES.SALE,
        Positions: [
          {
            Count: 1,
            Price: amountKzt,
            TaxType: cfg.taxType,
            TaxPercent: cfg.taxPercent,
            Tax: taxAmount,
            PositionName: serviceName,
            PositionCode: input.orderNumber,
            UnitCode: cfg.unitCode,
            Discount: 0,
            Markup: 0,
          },
        ],
        Payments: [
          {
            Sum: amountKzt,
            PaymentType: WEBKASSA_PAYMENT_TYPES.BANK_CARD,
          },
        ],
        Change: 0,
        RoundType: cfg.roundType,
        // ExternalCheckNumber = payment_transaction.id (UUID) = idempotency key
        ExternalCheckNumber: input.paymentTransactionId,
        ExternalOrderNumber: input.orderNumber,
        CustomerEmail: input.customerEmail,
        ExternalLinkId: crypto.randomUUID(),
      });

      return {
        status: 'issued',
        providerReceiptId: result.checkNumber,
        fiscalUrl: result.ticketUrl ?? result.ticketPrintUrl,
        shiftId: result.shiftNumber?.toString(),
        cashboxId: cfg.cashboxUniqueNumber,
        providerResponseSanitized: sanitizeForStorage(result.rawData) ?? undefined,
      };
    } catch (err) {
      const msg = (err as Error).message;
      const code = err instanceof WebkassaApiError ? String(err.code) : undefined;
      const isRetryable = err instanceof WebkassaNetworkError && err.isRetryable;

      console.error('[webkassa/provider] sale receipt failed', {
        errorCode: code,
        hasApiKey: !!cfg.apiKey,    // boolean only — never log the key value
        cashboxUniqueNumber: cfg.cashboxUniqueNumber,
      });

      return {
        status: isRetryable ? 'retry_required' : 'failed',
        errorCode: code,
        errorMessage: msg,
        providerResponseSanitized: { provider: 'webkassa', error: msg, errorCode: code },
      };
    }
  }

  async createRefundReceipt(input: FiscalRefundInput): Promise<FiscalReceiptResult> {
    const cfg = getWebkassaProviderConfig();
    const safety = checkSafetyGates(cfg);

    if (safety.blocked) {
      console.info('[webkassa/provider] refund receipt blocked by config', {
        reason: safety.reason,
        refundTransactionId: input.refundTransactionId,
      });
      return {
        status: safety.fallbackStatus,
        providerResponseSanitized: { provider: 'webkassa', blocked: true, reason: safety.reason },
      };
    }

    const amountKzt = input.amountKzt;
    const taxAmount = cfg.taxType === 100 ? +(amountKzt - amountKzt / (1 + cfg.taxPercent / 100)).toFixed(2) : 0;

    const clientConfig = this.getClientConfig(cfg);

    try {
      const result = await createCheck(clientConfig, {
        OperationType: WEBKASSA_OPERATION_TYPES.SALE_RETURN,
        Positions: [
          {
            Count: 1,
            Price: amountKzt,
            TaxType: cfg.taxType,
            TaxPercent: cfg.taxPercent,
            Tax: taxAmount,
            PositionName: cfg.serviceName,
            PositionCode: input.refundTransactionId.slice(0, 20),
            UnitCode: cfg.unitCode,
            Discount: 0,
            Markup: 0,
          },
        ],
        Payments: [
          {
            Sum: amountKzt,
            PaymentType: WEBKASSA_PAYMENT_TYPES.BANK_CARD,
          },
        ],
        Change: 0,
        RoundType: cfg.roundType,
        // ExternalCheckNumber for refund = refund_transaction.id
        ExternalCheckNumber: input.refundTransactionId,
        ExternalOrderNumber: input.refundTransactionId.slice(0, 20),
      });

      return {
        status: 'issued',
        providerReceiptId: result.checkNumber,
        fiscalUrl: result.ticketUrl ?? result.ticketPrintUrl,
        shiftId: result.shiftNumber?.toString(),
        cashboxId: cfg.cashboxUniqueNumber,
        providerResponseSanitized: sanitizeForStorage(result.rawData) ?? undefined,
      };
    } catch (err) {
      const msg = (err as Error).message;
      const code = err instanceof WebkassaApiError ? String(err.code) : undefined;
      const isRetryable = err instanceof WebkassaNetworkError && err.isRetryable;

      console.error('[webkassa/provider] refund receipt failed', {
        errorCode: code,
        hasApiKey: !!cfg.apiKey,    // boolean only — never log the key value
        cashboxUniqueNumber: cfg.cashboxUniqueNumber,
      });

      return {
        status: isRetryable ? 'retry_required' : 'failed',
        errorCode: code,
        errorMessage: msg,
        providerResponseSanitized: { provider: 'webkassa', error: msg, errorCode: code },
      };
    }
  }
}
