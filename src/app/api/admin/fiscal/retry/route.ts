/**
 * Admin endpoint: reset a failed/stuck fiscal receipt so the Railway worker retries it.
 *
 * This endpoint does NOT call Webkassa directly.
 * It only moves the DB row to retry_required status and clears error fields.
 * The Railway worker's fiscal-processor (30-second interval) picks it up automatically.
 *
 * Authorization: Bearer CRON_SECRET (same secret used by cron endpoints).
 *
 * Request body (one of):
 *   { "paymentTransactionId": "<uuid>" }  — looks up the sale receipt for this payment
 *   { "receiptId": "<uuid>" }             — targets a specific receipt row
 *
 * Allowed source statuses: failed, pending, retry_required, blocked_by_config
 *
 * Response 200:
 *   { ok: true, receiptId, previousStatus, newStatus: "retry_required" }
 *
 * Response 404: receipt not found
 * Response 409: receipt already issued (provider_receipt_id set) — refuse to reset
 * Response 422: status not resetable (e.g. issued, pending_manual)
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

const RESETABLE_STATUSES = ['failed', 'pending', 'retry_required', 'blocked_by_config'];

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth: CRON_SECRET bearer token
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const authHeader = req.headers.get('authorization') ?? '';
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const paymentTransactionId = typeof body['paymentTransactionId'] === 'string'
    ? body['paymentTransactionId']
    : null;
  const receiptId = typeof body['receiptId'] === 'string'
    ? body['receiptId']
    : null;

  if (!paymentTransactionId && !receiptId) {
    return NextResponse.json(
      { error: 'provide paymentTransactionId or receiptId' },
      { status: 400 },
    );
  }

  // Look up the receipt
  let query = supabaseServer
    .from('fiscal_receipts')
    .select('id, status, provider, provider_environment, provider_receipt_id, fiscal_url, operation_type, payment_transaction_id');

  if (receiptId) {
    query = query.eq('id', receiptId);
  } else {
    query = query
      .eq('payment_transaction_id', paymentTransactionId!)
      .eq('operation_type', 'sale');
  }

  const { data: receipt, error: fetchError } = await query.maybeSingle();

  if (fetchError) {
    console.error('[admin/fiscal/retry] DB error', { error: fetchError.message });
    return NextResponse.json({ error: 'db_error', detail: fetchError.message }, { status: 500 });
  }

  if (!receipt) {
    return NextResponse.json(
      { error: 'not_found', paymentTransactionId, receiptId },
      { status: 404 },
    );
  }

  // Refuse if already issued — would risk duplicate receipt
  if (receipt.provider_receipt_id || receipt.fiscal_url) {
    return NextResponse.json(
      {
        error: 'already_issued',
        message: 'Receipt already has provider_receipt_id or fiscal_url — refusing to reset',
        receiptId: receipt.id,
        provider_receipt_id: receipt.provider_receipt_id,
      },
      { status: 409 },
    );
  }

  if (!RESETABLE_STATUSES.includes(receipt.status)) {
    return NextResponse.json(
      {
        error: 'not_resetable',
        message: `Receipt status '${receipt.status}' cannot be reset. Allowed: ${RESETABLE_STATUSES.join(', ')}`,
        receiptId: receipt.id,
        status: receipt.status,
      },
      { status: 422 },
    );
  }

  const previousStatus = receipt.status;

  // Reset to retry_required so worker picks it up on next 30-second tick.
  // Does NOT call Webkassa.
  const { error: updateError } = await supabaseServer
    .from('fiscal_receipts')
    .update({
      status: 'retry_required',
      error_code: null,
      error_message: null,
      retry_count: 0,
      failed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', receipt.id);

  if (updateError) {
    console.error('[admin/fiscal/retry] DB update error', { error: updateError.message });
    return NextResponse.json({ error: 'db_error', detail: updateError.message }, { status: 500 });
  }

  console.info('[admin/fiscal/retry] receipt reset for worker retry', {
    receiptId: receipt.id,
    previousStatus,
    provider: receipt.provider,
    provider_environment: receipt.provider_environment,
    paymentTransactionId: receipt.payment_transaction_id,
  });

  return NextResponse.json({
    ok: true,
    receiptId: receipt.id,
    previousStatus,
    newStatus: 'retry_required',
    message: 'Receipt reset to retry_required. Railway worker will process within 30 seconds.',
  });
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Method not allowed. Use POST.' }, { status: 405 });
}
