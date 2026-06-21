import { z } from 'zod';

// ─── Halyk API response types ──────────────────────────────────────────────────

// Tolerant schema: Halyk test environment may return expires_in as a numeric string
// and may omit token_type. Unknown fields are passed through without failing.
export const HalykTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().optional(),
  expires_in: z.union([z.number(), z.string()]).transform(Number).optional(),
  scope: z.string().optional(),
}).passthrough();
export type HalykTokenResponse = z.infer<typeof HalykTokenResponseSchema>;

/**
 * The auth object returned by the token endpoint, to be passed to halyk.pay().
 * client_secret is never included here.
 */
export interface HalykPaymentAuth {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
}

/**
 * Payment object passed to window.halyk.pay().
 * Docs: https://epayment.kz/docs/platezhnaya-stranica
 */
export interface HalykPaymentObject {
  invoiceId: string;
  backLink: string;
  failureBackLink: string;
  autoBackLink: true;
  postLink: string;
  failurePostLink: string;
  language: 'rus' | 'kaz' | 'eng';
  description: string;
  accountId: string;
  terminal: string;
  amount: number;
  currency: 'KZT';
  email: string;
  phone?: string;
  auth: HalykPaymentAuth;
  data: string;
}

// ─── Halyk postLink callback payload ──────────────────────────────────────────

/**
 * Normalised postLink payload. Halyk docs are inconsistent about casing and field
 * names; we normalise known variants to canonical names.
 */
export const HalykPostLinkPayloadSchema = z.object({
  invoiceId: z.union([z.string(), z.number()]).transform(String),
  // Halyk docs show both 'code' and 'reason' — accept either
  code: z.string().optional(),
  reason: z.string().optional(),
  reasonCode: z.union([z.string(), z.number()]).transform(String).optional(),
  // extra optional fields Halyk may include
  amount: z.union([z.string(), z.number()]).optional(),
  currency: z.string().optional(),
  secret_hash: z.string().optional(),
  // Alternative casing seen in some Halyk environments
  invoiceID: z.string().optional(),
}).passthrough();

export type HalykPostLinkPayload = z.infer<typeof HalykPostLinkPayloadSchema>;

// ─── Halyk Status API response ────────────────────────────────────────────────

export type HalykTransactionStatusName =
  | 'NEW'
  | 'FINGERPRINT'
  | '3D'
  | 'AUTH'
  | 'CHARGE'
  | 'CANCEL'
  | 'CANCEL_OLD'
  | 'REFUND'
  | 'REJECT'
  | 'FAILED'
  | 'REJECT';

export const HalykTransactionSchema = z.object({
  invoiceID: z.union([z.string(), z.number()]).transform(String),
  terminalID: z.string().optional(),
  numericCardId: z.string().optional(),
  statusName: z.string(),
  amount: z.union([z.string(), z.number()]).transform((v) => Number(v)),
  currency: z.string(),
  description: z.string().optional(),
  language: z.string().optional(),
  cardMask: z.string().optional(),
  cardType: z.string().optional(),
  issuer: z.string().optional(),
  approvalCode: z.string().optional(),
  reference: z.string().optional(),
  secure: z.string().optional(),
  // Provider transaction identifier
  transactionId: z.union([z.string(), z.number()]).transform(String).optional(),
  // Alternative field names seen in docs
  reasonCode: z.union([z.string(), z.number()]).transform(String).optional(),
  reason: z.string().optional(),
}).passthrough();

export type HalykTransaction = z.infer<typeof HalykTransactionSchema>;

export const HalykStatusResponseSchema = z.object({
  resultCode: z.union([z.string(), z.number()]).transform(Number),
  resultMessage: z.string().optional(),
  transaction: HalykTransactionSchema.optional(),
}).passthrough();

export type HalykStatusResponse = z.infer<typeof HalykStatusResponseSchema>;

// ─── Internal payment status ───────────────────────────────────────────────────

export type InternalPaymentStatus =
  | 'payment_pending'
  | 'paid'
  | 'failed'
  | 'canceled'
  | 'refund_pending'
  | 'refunded'
  | 'requires_review'
  | 'duplicate_charge_review';

// ─── Safe bootstrap object returned to the browser ────────────────────────────

export interface HalykPayBootstrap {
  paymentId: string;
  paymentObject: HalykPaymentObject;
  scriptUrl: string;
}
