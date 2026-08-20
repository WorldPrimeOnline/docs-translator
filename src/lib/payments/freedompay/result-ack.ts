/**
 * Builds and (re)serialises WPO's signed ACK response to Freedom Pay's Result URL.
 *
 * Freedom Pay retries the Result URL every 30 min for up to 2 hours on any non-200
 * response, and documents that retries must receive the SAME response as the original
 * delivery — even after pg_lifetime has expired. Per the user's explicit design
 * decision, WPO does not regenerate pg_salt/pg_sig on every retry: the first computed
 * ACK for a given payment's terminal outcome is persisted into the existing
 * payment_transactions.provider_payload JSONB column (`_wpo_response` key — no schema
 * migration needed) and replayed verbatim by the result route on any subsequent
 * delivery for the same payment. See src/app/api/payments/freedompay/result/route.ts.
 */
import { randomBytes } from 'crypto';
import { buildSignature, deriveScriptNameFromUrl } from './signature';
import { buildFreedomPayResponseXml } from './xml';
import { getFreedomPayConfig, FREEDOMPAY_RESULT_PATH } from './config';

export interface FreedomPayAckFields {
  pg_status: 'ok' | 'error' | 'rejected';
  pg_description: string;
  pg_salt: string;
  pg_sig: string;
}

/** Script name used both to verify Freedom Pay's inbound signature and to sign this
 * ACK — derived once from the configured Result URL path (see config.ts and
 * signature.ts's module doc comment for why this is a design decision, not a
 * documented fact). */
export const FREEDOMPAY_RESULT_SCRIPT_NAME = deriveScriptNameFromUrl(FREEDOMPAY_RESULT_PATH);

export function buildResultAck(status: FreedomPayAckFields['pg_status'], description: string): FreedomPayAckFields {
  const config = getFreedomPayConfig();
  const salt = randomBytes(16).toString('hex');
  const fields = { pg_status: status, pg_description: description, pg_salt: salt };
  const sig = buildSignature(FREEDOMPAY_RESULT_SCRIPT_NAME, fields, config.secretKey);
  return { ...fields, pg_sig: sig };
}

export function resultAckToXml(ack: FreedomPayAckFields): string {
  const fields: Record<string, string> = {
    pg_status: ack.pg_status,
    pg_description: ack.pg_description,
    pg_salt: ack.pg_salt,
    pg_sig: ack.pg_sig,
  };
  return buildFreedomPayResponseXml(fields);
}
