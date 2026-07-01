/**
 * Webkassa API types and Zod validation schemas.
 * Server-side only.
 *
 * Based on: ИНТЕГРАТОРЫ_v4-2.0.3.postman_collection.json
 * Test base URL: https://devkkm.webkassa.kz
 * Production base URL: configured via WEBKASSA_API_BASE_URL
 */
import { z } from 'zod';

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const WebkassaErrorSchema = z.object({
  Code: z.number(),
  Text: z.string(),
});

export const WebkassaAuthResponseSchema = z.object({
  Data: z
    .object({
      Token: z.string().optional(),
    })
    .optional()
    .nullable(),
  Errors: z.array(WebkassaErrorSchema).optional().nullable(),
});

export type WebkassaAuthResponse = z.infer<typeof WebkassaAuthResponseSchema>;

// ─── Cashboxes ────────────────────────────────────────────────────────────────

export const WebkassaCashboxSchema = z.object({
  UniqueNumber: z.string(),
  RegistrationNumber: z.string().optional(),
  IdentificationNumber: z.string().optional(),
  Name: z.string().optional(),
  Description: z.string().optional(),
}).passthrough();

export const WebkassaCashboxesResponseSchema = z.object({
  Data: z
    .object({
      List: z.array(WebkassaCashboxSchema).optional(),
    })
    .optional()
    .nullable(),
  Errors: z.array(WebkassaErrorSchema).optional().nullable(),
});

// ─── Check (receipt) ─────────────────────────────────────────────────────────

/** OperationType values per Webkassa API */
export const WEBKASSA_OPERATION_TYPES = {
  PURCHASE: 0,
  PURCHASE_RETURN: 1,
  SALE: 2,
  SALE_RETURN: 3,
} as const;

/** PaymentType values per Webkassa API */
export const WEBKASSA_PAYMENT_TYPES = {
  CASH: 0,
  BANK_CARD: 1,
  MOBILE: 4,
} as const;

/** TaxType values per Webkassa API */
export const WEBKASSA_TAX_TYPES = {
  NO_TAX: 0,
  VAT: 100,
} as const;

export interface WebkassaPosition {
  Count: number;
  Price: number;
  TaxPercent: number;
  Tax: number;
  TaxType: 0 | 100;
  PositionName: string;
  PositionCode?: string;
  Discount?: number;
  Markup?: number;
  SectionCode?: string;
  /** Unit of measurement code. 796 = шт (piece) */
  UnitCode: number;
}

export interface WebkassaPayment {
  Sum: number;
  PaymentType: 0 | 1 | 4;
}

export interface WebkassaCheckRequest {
  Token: string;
  CashboxUniqueNumber: string;
  OperationType: 0 | 1 | 2 | 3;
  Positions: WebkassaPosition[];
  Payments: WebkassaPayment[];
  Change: number;
  RoundType: number;
  /** IDEMPOTENCY KEY — UUID. On duplicate, Webkassa returns Error 14 + existing Data. */
  ExternalCheckNumber: string;
  ExternalOrderNumber?: string;
  CustomerEmail?: string;
  CustomerPhone?: string;
  CustomerXin?: string;
  ExternalLinkId?: string;
  /**
   * Intended for OperationType=3 (SALE_RETURN) — pass CheckNumber from the original sale.
   * NOTE: The exact field name/value required by Webkassa for return receipts is not
   * documented in the Postman collection. Error 9 ("Необходимо заполнить данные чека
   * основания") occurs on the test cashbox regardless of this field; may be a cashbox
   * configuration issue. Confirm with Webkassa support before production use.
   */
  OriginalTransactionId?: string;
}

export const WebkassaOfdSchema = z.object({
  Name: z.string().optional(),
  Host: z.string().optional(),
  Code: z.number().optional(),
}).passthrough();

export const WebkassaCheckDataSchema = z.object({
  CheckNumber: z.string().optional(),
  DateTime: z.string().optional(),
  DateTimeUTC: z.string().optional(),
  OfflineMode: z.boolean().optional(),
  ShiftNumber: z.number().optional(),
  CheckOrderNumber: z.number().optional(),
  Total: z.number().optional(),
  EmployeeName: z.string().optional(),
  /** OFD public receipt link (e.g., wofd.kz consumer link) */
  TicketUrl: z.string().optional(),
  /** Webkassa print link */
  TicketPrintUrl: z.string().optional(),
  Cashbox: z
    .object({
      UniqueNumber: z.string().optional(),
      RegistrationNumber: z.string().optional(),
      IdentityNumber: z.union([z.string(), z.number()]).optional(),
      Ofd: WebkassaOfdSchema.optional(),
    })
    .optional(),
  Organization: z
    .object({
      TaxPayerName: z.string().optional(),
      TaxPayerIN: z.string().optional(),
    })
    .optional(),
}).passthrough();

export const WebkassaCheckResponseSchema = z.object({
  Data: WebkassaCheckDataSchema.optional().nullable(),
  Errors: z.array(WebkassaErrorSchema).optional().nullable(),
});

export type WebkassaCheckResponse = z.infer<typeof WebkassaCheckResponseSchema>;
export type WebkassaCheckData = z.infer<typeof WebkassaCheckDataSchema>;

// ─── Error codes ─────────────────────────────────────────────────────────────

export const WEBKASSA_ERROR_CODES = {
  UNKNOWN: -1,
  WRONG_CREDENTIALS: 1,
  SESSION_EXPIRED: 2,
  NOT_AUTHORIZED: 3,
  NO_ACCESS: 4,
  NO_CASHBOX_ACCESS: 5,
  CASHBOX_NOT_FOUND: 6,
  CASHBOX_BLOCKED: 7,
  INSUFFICIENT_FUNDS: 8,
  VALIDATION_ERROR: 9,
  CASHBOX_NOT_ACTIVATED: 10,
  SHIFT_OVER_24H: 11,
  SHIFT_ALREADY_CLOSED: 12,
  NO_OPEN_SHIFT: 13,
  DUPLICATE_EXTERNAL_NUMBER: 14,  // ExternalCheckNumber already exists — IDEMPOTENT
  SHIFT_NOT_FOUND: 15,
  CHECK_NOT_FOUND: 16,
  OFFLINE_DURATION_EXCEEDED: 18,
  SERVICE_UNAVAILABLE: 505,
  SHIFT_ALREADY_OPEN: 1014,
} as const;

/** Error codes that indicate a transient condition — safe to retry */
export const RETRYABLE_ERROR_CODES = new Set([
  WEBKASSA_ERROR_CODES.SERVICE_UNAVAILABLE,
  WEBKASSA_ERROR_CODES.UNKNOWN,
]);

/** Error code 14 = duplicate ExternalCheckNumber. Webkassa returns existing Data — treat as success. */
export const DUPLICATE_CHECK_CODE = WEBKASSA_ERROR_CODES.DUPLICATE_EXTERNAL_NUMBER;

/** Error codes that indicate a Z-report is already complete (idempotent for shift close). */
export const Z_REPORT_ALREADY_DONE_CODES = new Set([
  WEBKASSA_ERROR_CODES.SHIFT_ALREADY_CLOSED,  // 12 — shift already closed today
  WEBKASSA_ERROR_CODES.NO_OPEN_SHIFT,          // 13 — no open shift to close
]);

// ─── Z-report ─────────────────────────────────────────────────────────────────

export const WebkassaZReportDataSchema = z.object({
  ShiftNumber: z.number().optional(),
  OpenDate: z.string().optional(),
  CloseDate: z.string().optional(),
  DocumentCount: z.number().optional(),
  FirstDocumentNumber: z.number().optional(),
  LastDocumentNumber: z.number().optional(),
}).passthrough();

export const WebkassaZReportResponseSchema = z.object({
  Data: WebkassaZReportDataSchema.optional().nullable(),
  Errors: z.array(WebkassaErrorSchema).optional().nullable(),
});

export type WebkassaZReportData = z.infer<typeof WebkassaZReportDataSchema>;
export type WebkassaZReportResponse = z.infer<typeof WebkassaZReportResponseSchema>;
