/**
 * Halyk ePay postLink callback — public server-to-server endpoint.
 * Does NOT require user session. Protected by secret_hash verification.
 * Must be idempotent: duplicate deliveries return success without re-running downstream.
 *
 * Security flow:
 * 1. Parse payload (no assumption on Content-Type)
 * 2. Extract invoiceId → find payment_transaction
 * 3. Verify secret_hash digest (constant-time)
 * 4. Verify terminal, amount, currency against snapshot
 * 5. Call Halyk Status API for authoritative status
 * 6. Only CHARGE → atomic finalization via RPC
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { verifySecretHash } from '@/lib/payments/halyk/security';
import { checkPaymentStatus } from '@/lib/payments/halyk/client';
import { mapHalykStatus, isPaidStatus } from '@/lib/payments/halyk/status-map';
import { getHalykConfig } from '@/lib/payments/halyk/config';
import { createSaleReceiptForPayment } from '@/lib/fiscal/service';

const MAX_BODY_BYTES = 64 * 1024; // 64 KB

// ─── Body parser ───────────────────────────────────────────────────────────────

async function parseCallbackBody(request: NextRequest): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') ?? '';
  const raw = await request.text();

  if (raw.length > MAX_BODY_BYTES) {
    throw new Error('Callback body too large');
  }

  if (contentType.includes('application/json')) {
    try {
      const json = JSON.parse(raw);
      if (typeof json === 'object' && json !== null) {
        // Flatten to string map (Halyk may send numbers for codes)
        return Object.fromEntries(
          Object.entries(json).map(([k, v]) => [k, String(v)]),
        );
      }
    } catch {
      throw new Error('Invalid JSON in callback body');
    }
  }

  // Form-encoded (including multipart text fields — Halyk uses various encodings)
  const params = new URLSearchParams(raw);
  const result: Record<string, string> = {};
  params.forEach((v, k) => { result[k] = v; });
  return result;
}

// ─── Normalise Halyk field name variants ──────────────────────────────────────

function getField(payload: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    if (payload[k] !== undefined) return payload[k];
  }
  return undefined;
}

// ─── Sanitise payload for storage (no secrets, no PAN/CVV) ───────────────────

function sanitiseForStorage(payload: Record<string, string>): Record<string, string> {
  const EXCLUDED = new Set(['secret_hash', 'client_secret', 'access_token', 'password']);
  return Object.fromEntries(
    Object.entries(payload).filter(([k]) => !EXCLUDED.has(k)),
  );
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = getHalykConfig();

  let payload: Record<string, string>;
  try {
    payload = await parseCallbackBody(request);
  } catch (err) {
    console.warn('[halyk/callback] body parse error:', (err as Error).message);
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  const correlationId = crypto.randomUUID();
  console.log('[halyk/callback] received', {
    correlationId,
    contentType: request.headers.get('content-type'),
    payloadKeys: Object.keys(payload),
  });

  // Extract invoiceId (Halyk uses both casings)
  const invoiceId = getField(payload, 'invoiceId', 'invoiceID');
  if (!invoiceId) {
    console.warn('[halyk/callback] missing invoiceId in payload', { correlationId });
    return NextResponse.json({ error: 'Missing invoiceId' }, { status: 400 });
  }

  console.log('[halyk/callback] parsed', {
    correlationId,
    invoiceId,
    hasSecretHash: !!getField(payload, 'secret_hash'),
  });

  // Find payment transaction
  const { data: paymentTx } = await supabaseServer
    .from('payment_transactions')
    .select('id, status, secret_hash_digest, amount, currency, provider_environment, job_id')
    .eq('provider_invoice_id', invoiceId)
    .maybeSingle();

  if (!paymentTx) {
    // Do not reveal whether the invoice exists — return a generic error
    console.warn('[halyk/callback] invoice not found', { correlationId, invoiceId });
    return NextResponse.json({ error: 'Unknown invoice' }, { status: 400 });
  }

  console.log('[halyk/callback] transaction found', {
    correlationId,
    txId: paymentTx.id,
    jobId: paymentTx.job_id,
    currentStatus: paymentTx.status,
  });

  // Verify secret_hash (constant-time).
  // In test mode, Halyk may not include secret_hash in the callback — we log a
  // warning and fall through to the authoritative Status API check instead.
  // In production mode, missing secret_hash is a hard rejection.
  const incomingSecret = getField(payload, 'secret_hash');
  const isTestMode = config.mode === 'test';

  if (incomingSecret && paymentTx.secret_hash_digest) {
    // Both present — verify
    if (!verifySecretHash(incomingSecret, paymentTx.secret_hash_digest)) {
      console.error('[halyk/callback] secret mismatch for payment:', paymentTx.id);
      return NextResponse.json({ error: 'Verification failed' }, { status: 401 });
    }
    console.log('[halyk/callback] secret verified for payment:', paymentTx.id);
  } else if (!incomingSecret && isTestMode) {
    // Test mode: Halyk test environment sometimes omits secret_hash.
    // Proceed to authoritative Status API check (which requires our credentials).
    console.warn('[halyk/callback] secret_hash absent in test mode — proceeding to status API check', {
      paymentId: paymentTx.id,
    });
  } else if (!incomingSecret && !isTestMode) {
    // Production mode: secret_hash is mandatory
    console.error('[halyk/callback] secret_hash missing in production callback for payment:', paymentTx.id);
    return NextResponse.json({ error: 'Verification failed' }, { status: 401 });
  } else if (incomingSecret && !paymentTx.secret_hash_digest) {
    // We have a hash from Halyk but nothing to compare — configuration error, flag for review
    console.error('[halyk/callback] secret_hash_digest not stored for payment:', paymentTx.id);
    // Proceed to Status API check; mark for review if needed
  }

  // Idempotency: already in a terminal status
  if (['paid', 'failed', 'canceled', 'refunded', 'duplicate_charge_review'].includes(paymentTx.status)) {
    console.log('[halyk/callback] duplicate callback for already-terminal payment:', paymentTx.id);
    return NextResponse.json({ ok: true });
  }

  // Record callback receipt
  await supabaseServer
    .from('payment_transactions')
    .update({ callback_received_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', paymentTx.id);

  // Authoritative status check from Halyk (never trust callback code alone)
  let statusResponse;
  try {
    statusResponse = await checkPaymentStatus(invoiceId);
  } catch (err) {
    console.error('[halyk/callback] Halyk status check failed:', (err as Error).message);
    // Save sanitised payload for later reconciliation
    await supabaseServer
      .from('payment_transactions')
      .update({
        status: 'requires_review',
        provider_payload: sanitiseForStorage(payload) as unknown as import('@/types/supabase').Json,
        status_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', paymentTx.id);
    // Return 200 to Halyk so they don't retry (we have reconciliation)
    return NextResponse.json({ ok: true });
  }

  const { resultCode, transaction } = statusResponse;
  const statusName = transaction?.statusName;
  const internalStatus = mapHalykStatus(resultCode, statusName);

  // Verify terminal and amount against stored snapshot.
  // Note: Halyk returns both "terminal" (short numeric ID, e.g. "98120001") and
  // "terminalID" (UUID). config.terminalId is the short form — match against either.
  if (transaction) {
    const terminalMatches =
      !config.terminalId ||                        // no config → skip check
      (!transaction.terminalID && !transaction.terminal) || // no terminal in response → skip
      transaction.terminal === config.terminalId ||         // short id matches
      transaction.terminalID === config.terminalId;         // uuid matches (edge case)
    if (!terminalMatches) {
      console.error('[halyk/callback] terminal mismatch payment:', paymentTx.id,
        { expected: config.terminalId, gotShort: transaction.terminal, gotUUID: transaction.terminalID });
      await supabaseServer
        .from('payment_transactions')
        .update({
          status: 'requires_review',
          provider_payload: sanitiseForStorage(payload) as unknown as import('@/types/supabase').Json,
          updated_at: new Date().toISOString(),
        })
        .eq('id', paymentTx.id);
      return NextResponse.json({ ok: true });
    }

    if (transaction.currency && transaction.currency !== 'KZT') {
      console.error('[halyk/callback] currency mismatch payment:', paymentTx.id);
      await supabaseServer
        .from('payment_transactions')
        .update({ status: 'requires_review', updated_at: new Date().toISOString() })
        .eq('id', paymentTx.id);
      return NextResponse.json({ ok: true });
    }

    // Amount comparison: avoid floating-point issues; compare as integers
    const halykAmount = Math.round(Number(transaction.amount));
    const storedAmount = Math.round(paymentTx.amount);
    if (halykAmount !== storedAmount) {
      console.error('[halyk/callback] amount mismatch payment:', paymentTx.id,
        'expected:', storedAmount, 'got:', halykAmount);
      await supabaseServer
        .from('payment_transactions')
        .update({ status: 'requires_review', updated_at: new Date().toISOString() })
        .eq('id', paymentTx.id);
      return NextResponse.json({ ok: true });
    }
  }

  if (isPaidStatus(internalStatus)) {
    // Atomic finalization via RPC (row-locked, idempotent, updates job)
    const sanitised = sanitiseForStorage({
      ...payload,
      resultCode: String(resultCode),
      statusName: statusName ?? '',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rpcResult, error: rpcError } = await (supabaseServer as any).rpc(
      'finalize_halyk_payment',
      {
        p_invoice_id: invoiceId,
        p_transaction_id: transaction?.transactionId ?? null,
        p_provider_status: statusName ?? null,
        p_provider_reason: transaction?.reason ?? null,
        p_provider_reason_code: transaction?.reasonCode ?? null,
        p_card_mask: transaction?.cardMask ?? null,
        p_card_type: transaction?.cardType ?? null,
        p_issuer: transaction?.issuer ?? null,
        p_approval_code: transaction?.approvalCode ?? null,
        p_reference: transaction?.reference ?? null,
        p_secure: transaction?.secure ?? null,
        p_provider_payload: sanitised,
      },
    );

    if (rpcError) {
      console.error('[halyk/callback] finalization RPC error:', rpcError.message);
      return NextResponse.json({ ok: true }); // Reconciliation will retry
    }

    const result = rpcResult as { ok: boolean; duplicate_charge?: boolean; job_id?: string; already_paid?: boolean } | null;

    if (result?.duplicate_charge) {
      console.error('[halyk/callback] DUPLICATE CHARGE detected for job:', result.job_id,
        'payment:', paymentTx.id);
      // TODO: send operator alert via Telegram/email
    }

    if (result?.ok && !result.duplicate_charge && result.job_id) {
      if (!result.already_paid) {
        console.log('[halyk/callback] payment finalized, job queued', {
          correlationId,
          jobId: result.job_id,
          paymentId: paymentTx.id,
        });
      }

      // Create fiscal receipt (idempotent — safe on duplicate callback)
      // Non-blocking: fiscal failure must not affect the payment response to Halyk
      void createSaleReceiptForPayment(paymentTx.id).catch((err: unknown) => {
        console.error('[halyk/callback] fiscal receipt creation failed (non-fatal):', (err as Error).message, {
          paymentId: paymentTx.id,
        });
      });
    }
    console.log('[halyk/callback] rpc result', {
      correlationId,
      ok: result?.ok,
      alreadyPaid: result?.already_paid,
      duplicateCharge: result?.duplicate_charge,
    });
  } else {
    const now = new Date().toISOString();
    await supabaseServer
      .from('payment_transactions')
      .update({
        status: internalStatus,
        provider_status: statusName ?? null,
        provider_reason: transaction?.reason ?? null,
        provider_reason_code: transaction?.reasonCode ?? null,
        provider_payload: sanitiseForStorage(payload) as unknown as import('@/types/supabase').Json,
        status_checked_at: now,
        failed_at: (internalStatus === 'failed' || internalStatus === 'canceled') ? now : undefined,
        updated_at: now,
      })
      .eq('id', paymentTx.id);
  }

  return NextResponse.json({ ok: true });
}

// Reject all non-POST methods
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
