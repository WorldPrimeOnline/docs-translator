import { NextResponse } from 'next/server';

export async function POST(): Promise<NextResponse> {
  return NextResponse.json(
    { error: 'Subscription payments temporarily unavailable' },
    { status: 503 },
  );
}
