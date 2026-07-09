#!/usr/bin/env npx tsx
/**
 * One-time backfill for a price_quotes row stuck at a non-paid status while its
 * payment_transactions row is already 'paid' — WO-75 incident, 2026-07-09.
 *
 * Root cause (already fixed going forward — see commit for the Halyk callback
 * fix): markQuotePaid() was called fire-and-forget (`void ... .catch()`) in
 * src/app/api/payments/halyk/callback/route.ts, so a Vercel serverless function
 * could return its response before that write completed. It's now awaited.
 * This script is the one-off repair for quotes that got stuck BEFORE that fix.
 *
 * This is a SEPARATE, independent script from 2026-07-09_repair-wo75-drive-jira.ts —
 * it never touches Drive, Jira, or R2. It replicates EXACTLY what the canonical
 * markQuotePaid() (src/lib/pricing/service.ts) does — nothing more:
 *   1. price_quotes: status='paid', paid_at=now, price_locked_at=now, updated_at=now
 *   2. cost_reservations: status='committed', payment_transaction_id=<tx id>,
 *      updated_at=now — WHERE quote_id=<this quote> AND status='reserved'
 *
 * price_quotes has NO payment_transaction_id column — that FK lives on
 * cost_reservations instead. This script does not invent a column that doesn't exist.
 *
 * SAFETY:
 *   - Default mode is DRY RUN — prints every action it would take, writes nothing.
 *   - Requires --apply AND the env var CONFIRM_PRODUCTION_WRITE=true to write anything.
 *   - REFUSES to act unless payment_transactions.status is verified 'paid' first —
 *     never marks a quote paid based on assumption or a client-supplied flag.
 *   - Idempotent: if price_quotes.status is already 'paid', reports and exits, no write.
 *   - Never touches amount_kzt or any other pricing field — status/timestamp fields only.
 *   - Does not touch jobs, documents, Drive, Jira, or R2.
 *
 * Usage:
 *   npx tsx scripts/prod/2026-07-09_backfill-quote-paid.ts --quote-id <uuid> --env-file <path>
 *   npx tsx scripts/prod/2026-07-09_backfill-quote-paid.ts --quote-id <uuid> --env-file <path> --apply
 *
 * Required env vars (see 2026-07-09_repair-wo75-drive-jira.ts header — same Supabase
 * vars only; R2/Google/Jira are not needed here):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Do NOT run --apply until the dry-run output has been reviewed and approved.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

// ─── CLI args ─────────────────────────────────────────────────────────────────

const QUOTE_ID_DEFAULT = '363cf220-b9e2-4fb6-9c33-150c63ed4c84'; // WO-75's quote

function parseArgs(): { quoteId: string; apply: boolean; envFile: string | null } {
  const args = process.argv.slice(2);
  let quoteId = QUOTE_ID_DEFAULT;
  let apply = false;
  let envFile: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--quote-id' && args[i + 1]) quoteId = args[++i]!;
    if (args[i] === '--apply') apply = true;
    if (args[i] === '--env-file' && args[i + 1]) envFile = args[++i]!;
  }
  return { quoteId, apply, envFile };
}

const { quoteId: QUOTE_ID, apply: APPLY, envFile: ENV_FILE } = parseArgs();

// ─── Env loading ──────────────────────────────────────────────────────────────

if (ENV_FILE && fs.existsSync(path.resolve(ENV_FILE))) {
  dotenv.config({ path: path.resolve(ENV_FILE) });
  console.log(`[backfill-quote] loaded env from ${ENV_FILE}`);
} else {
  console.log('[backfill-quote] no --env-file given — relying on shell environment only');
}

if (APPLY && process.env.CONFIRM_PRODUCTION_WRITE !== 'true') {
  console.error(
    '[backfill-quote] REFUSED: --apply requires CONFIRM_PRODUCTION_WRITE=true to be set explicitly. ' +
    'Run without --apply first and review the dry-run output.',
  );
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('[backfill-quote] FATAL: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = createClient(SUPABASE_URL, SERVICE_KEY) as any;

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n[backfill-quote] quote=${QUOTE_ID} mode=${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const { data: quote, error: quoteErr } = await db
    .from('price_quotes')
    .select('id, job_id, status, amount_kzt, currency, quoted_at, paid_at, price_locked_at, updated_at')
    .eq('id', QUOTE_ID)
    .maybeSingle();

  if (quoteErr || !quote) {
    console.error('[backfill-quote] quote not found:', quoteErr?.message ?? QUOTE_ID);
    process.exit(1);
  }

  const { data: paymentTx } = await db
    .from('payment_transactions')
    .select('id, status, amount, currency, paid_at')
    .eq('quote_id', QUOTE_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  console.log('════════════════════════════════════════════════════════════');
  console.log('CURRENT STATE');
  console.log('════════════════════════════════════════════════════════════');
  console.log({
    quoteId: quote.id,
    jobId: quote.job_id,
    quoteStatus: quote.status,
    quoteAmountKzt: quote.amount_kzt,
    quotePaidAt: quote.paid_at,
    quotePriceLockedAt: quote.price_locked_at,
    paymentTransactionId: paymentTx?.id ?? null,
    paymentTransactionStatus: paymentTx?.status ?? '(no payment_transactions row found for this quote_id)',
    paymentTransactionAmount: paymentTx?.amount ?? null,
    paymentTransactionPaidAt: paymentTx?.paid_at ?? null,
  });
  console.log('');

  // ── Safety gate 1: quote already paid — nothing to do, idempotent no-op ────
  if (quote.status === 'paid') {
    console.log('[backfill-quote] price_quotes.status is already "paid" — nothing to do, no write needed.');
    return;
  }

  // ── Safety gate 2: never mark a quote paid unless payment is verified paid ──
  if (!paymentTx || paymentTx.status !== 'paid') {
    console.error(
      `[backfill-quote] REFUSED: payment_transactions.status is "${paymentTx?.status ?? 'not found'}", not "paid". ` +
      'This script will never mark a quote paid unless the linked payment is independently confirmed paid. ' +
      'No plan generated, no write possible.',
    );
    process.exit(1);
  }

  // ── Safety gate 3: amount sanity check (never trust — verify) ──────────────
  const amountsMatch = Math.round(Number(quote.amount_kzt)) === Math.round(Number(paymentTx.amount));
  console.log('════════════════════════════════════════════════════════════');
  console.log('BACKFILL PLAN');
  console.log('════════════════════════════════════════════════════════════');
  console.log(`amountsMatch (quote.amount_kzt vs payment_transactions.amount): ${amountsMatch} (${quote.amount_kzt} vs ${paymentTx.amount})`);
  if (!amountsMatch) {
    console.error(
      '[backfill-quote] REFUSED: quote amount and paid transaction amount do not match. ' +
      'This needs manual investigation before any backfill — refusing to proceed automatically.',
    );
    process.exit(1);
  }

  console.log('\nprice_quotes row fields that would be updated:');
  console.log(`  status           : "${quote.status}" → "paid"`);
  console.log(`  paid_at          : ${quote.paid_at ?? 'null'} → (current timestamp)`);
  console.log(`  price_locked_at  : ${quote.price_locked_at ?? 'null'} → (current timestamp)`);
  console.log(`  updated_at       : ${quote.updated_at ?? 'null'} → (current timestamp)`);
  console.log('  (amount_kzt and all other pricing fields are NOT touched)');

  const { data: reservations } = await db
    .from('cost_reservations')
    .select('id, cost_type, amount_kzt, status')
    .eq('quote_id', QUOTE_ID);

  const reservedRows = (reservations ?? []).filter((r: { status: string }) => r.status === 'reserved');
  const otherRows = (reservations ?? []).filter((r: { status: string }) => r.status !== 'reserved');

  console.log(`\ncost_reservations rows found: ${(reservations ?? []).length} total`);
  console.log(`  ${reservedRows.length} row(s) with status='reserved' would be updated to 'committed':`);
  for (const r of reservedRows) {
    console.log(`    - ${r.cost_type}: ${r.amount_kzt} KZT (id=${r.id})`);
  }
  if (otherRows.length > 0) {
    console.log(`  ${otherRows.length} row(s) already in a different status (left untouched):`);
    for (const r of otherRows) {
      console.log(`    - ${r.cost_type}: status=${r.status} (id=${r.id})`);
    }
  }
  console.log(`  each would get: payment_transaction_id="${paymentTx.id}", updated_at=(current timestamp)`);
  console.log('');

  if (!APPLY) {
    console.log('[backfill-quote] DRY RUN — no writes made. Re-run with --apply (and CONFIRM_PRODUCTION_WRITE=true) once approved.');
    return;
  }

  const now = new Date().toISOString();

  const { error: quoteUpdateErr } = await db
    .from('price_quotes')
    .update({ status: 'paid', paid_at: now, price_locked_at: now, updated_at: now })
    .eq('id', QUOTE_ID)
    .neq('status', 'paid'); // idempotency guard even under --apply

  if (quoteUpdateErr) {
    console.error('[backfill-quote] FAILED to update price_quotes:', quoteUpdateErr.message);
    process.exit(1);
  }
  console.log(`[backfill-quote] ✓ price_quotes ${QUOTE_ID} → status=paid`);

  const { error: reservationUpdateErr } = await db
    .from('cost_reservations')
    .update({ status: 'committed', payment_transaction_id: paymentTx.id, updated_at: now })
    .eq('quote_id', QUOTE_ID)
    .eq('status', 'reserved');

  if (reservationUpdateErr) {
    console.error('[backfill-quote] FAILED to update cost_reservations (price_quotes update already applied above — not rolled back):', reservationUpdateErr.message);
    process.exit(1);
  }
  console.log(`[backfill-quote] ✓ cost_reservations for quote ${QUOTE_ID} → status=committed (${reservedRows.length} row(s))`);
}

main().catch((err) => {
  console.error('[backfill-quote] FATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
