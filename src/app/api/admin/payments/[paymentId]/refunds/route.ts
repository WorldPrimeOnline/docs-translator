/**
 * Admin-only: list refunds for a payment transaction.
 *
 * STATUS: PROTECTED PLACEHOLDER
 *
 * Returns 501 until admin authentication is implemented.
 * See docs/payments/REFUNDS.md for manual operator process.
 */
import { NextResponse } from 'next/server';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: 'not_implemented',
      message: 'Admin refund list endpoint requires admin authentication. See docs/payments/REFUNDS.md.',
    },
    { status: 501 },
  );
}
