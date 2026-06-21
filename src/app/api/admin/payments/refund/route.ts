/**
 * Admin-only refund initiation endpoint.
 *
 * STATUS: PROTECTED PLACEHOLDER
 *
 * This route returns 501 until a proper admin authentication system is implemented.
 * The refund service functions exist and are ready to use.
 *
 * To implement:
 * 1. Add admin auth middleware (staff_profiles role check + session validation).
 * 2. Enable the route body below (currently unreachable).
 * 3. Protect with rate limiting and audit log.
 *
 * Manual operator process (until this endpoint is enabled):
 *   1. Find the payment: SELECT * FROM payment_transactions WHERE id = '<id>';
 *   2. Confirm payment is 'paid' and provider_transaction_id is set.
 *   3. Log into Halyk merchant cabinet → initiate refund for that transaction.
 *   4. After Halyk confirms: UPDATE refund_transactions SET status='succeeded' ...
 *   5. Issue fiscal correction receipt via OFD cabinet.
 *   6. Notify customer via email/Telegram.
 *
 * See docs/payments/REFUNDS.md for the full manual process.
 */
import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: 'not_implemented',
      message: 'Admin refund endpoint requires admin authentication. See docs/payments/REFUNDS.md.',
    },
    { status: 501 },
  );
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: 'Method not allowed' }, { status: 405 });
}
