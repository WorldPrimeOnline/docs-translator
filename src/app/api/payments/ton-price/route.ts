import { NextResponse } from 'next/server';
import { getTonPriceUsd } from '@/lib/ton/price';

export async function GET(): Promise<NextResponse> {
  try {
    const tonPriceUsd = await getTonPriceUsd();
    return NextResponse.json({ tonPriceUsd, timestamp: Date.now() });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch TON price' }, { status: 502 });
  }
}
