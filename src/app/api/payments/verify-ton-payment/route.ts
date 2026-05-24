import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { MERCHANT_ADDRESS } from '@/lib/ton/config';
import { processJob } from '@/lib/jobs/processor';
import { Address } from '@ton/core';
import type { Database } from '@/types';

const TONCENTER_URL = 'https://toncenter.com/api/v2/getTransactions';

async function getAuthUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// toncenter sometimes returns address as {address:"..."} object instead of plain string
function extractAddrString(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && 'address' in val) {
    return String((val as Record<string, unknown>).address);
  }
  return '';
}

function tryNormalize(addr: string): string | null {
  if (!addr) return null;
  try {
    return Address.parse(addr).toRawString();
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { jobId, documentId, amountNanoton } = (await request.json()) as {
      jobId?: string;
      documentId?: string;
      amountNanoton?: string;
    };
    if (!jobId || !documentId || !amountNanoton) {
      return NextResponse.json(
        { error: 'jobId, documentId and amountNanoton are required' },
        { status: 400 },
      );
    }

    const { data: payment } = await supabaseServer
      .from('ton_payments')
      .select('*')
      .eq('job_id', jobId)
      .eq('user_id', user.id)
      .single();

    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    if (payment.status === 'completed') return NextResponse.json({ verified: true });

    const now = new Date();
    const expiresAt = new Date(payment.expires_at);
    if (now > expiresAt) {
      await supabaseServer.from('ton_payments').update({ status: 'expired' }).eq('id', payment.id);
      return NextResponse.json({ verified: false, expired: true });
    }

    const { data: walletLink } = await supabaseServer
      .from('wallet_links')
      .select('address_raw, address')
      .eq('user_id', user.id)
      .single();

    if (!walletLink) {
      console.log('[verify] no wallet linked for user', user.id);
      return NextResponse.json({ verified: false, error: 'Wallet not linked' });
    }

    const merchantRaw = tryNormalize(MERCHANT_ADDRESS);
    const minAmount = Math.floor(Number(amountNanoton) * 0.99);
    const windowStartSec = Math.floor(now.getTime() / 1000) - 1800;

    console.log('[verify] checking payment', {
      jobId,
      walletAddressRaw: walletLink.address_raw,
      walletAddressDisplay: walletLink.address,
      merchantAddressOriginal: MERCHANT_ADDRESS,
      merchantAddressNormalized: merchantRaw,
      minAmountNanoton: minAmount,
      windowStartSec,
    });

    const url = new URL(TONCENTER_URL);
    url.searchParams.set('address', MERCHANT_ADDRESS);
    url.searchParams.set('limit', '50');
    const apiKey = process.env.TONCENTER_API_KEY;
    if (apiKey) url.searchParams.set('api_key', apiKey);

    const tcRes = await fetch(url.toString(), { cache: 'no-store' });
    if (!tcRes.ok) {
      console.log('[verify] toncenter HTTP error', tcRes.status);
      return NextResponse.json({ verified: false });
    }

    const tcData = (await tcRes.json()) as { ok: boolean; result: unknown[] };
    if (!tcData.ok || !Array.isArray(tcData.result)) {
      console.log('[verify] toncenter bad response', JSON.stringify(tcData).slice(0, 200));
      return NextResponse.json({ verified: false });
    }

    console.log('[verify] toncenter returned', tcData.result.length, 'transactions');

    for (const rawTx of tcData.result) {
      const tx = rawTx as Record<string, unknown>;
      const inMsg = tx.in_msg as Record<string, unknown> | undefined;

      const sourceRaw = extractAddrString(inMsg?.source);
      const destRaw = extractAddrString(inMsg?.destination);
      const value = String(inMsg?.value ?? '0');
      const utime = Number(tx.utime ?? 0);

      console.log('[verify] TX:', JSON.stringify({ source: inMsg?.source, destination: inMsg?.destination, value, utime }));

      if (utime < windowStartSec) {
        console.log('[verify]   skip: too old', utime, '<', windowStartSec);
        continue;
      }

      // Try normalised comparison first, fall back to plain string comparison
      const normalizedFrom = tryNormalize(sourceRaw);
      const normalizedDest = tryNormalize(destRaw);

      const fromMatch =
        (normalizedFrom !== null && normalizedFrom === walletLink.address_raw) ||
        sourceRaw === walletLink.address_raw ||
        sourceRaw === walletLink.address;

      const destMatch =
        (normalizedDest !== null && merchantRaw !== null && normalizedDest === merchantRaw) ||
        destRaw === MERCHANT_ADDRESS;

      const amountMatch = Number(value) >= minAmount;

      console.log('[verify]   from match:', fromMatch, { normalizedFrom, storedRaw: walletLink.address_raw, sourceRaw });
      console.log('[verify]   dest match:', destMatch, { normalizedDest, merchantRaw, destRaw });
      console.log('[verify]   amount match:', amountMatch, { value, minAmount });

      if (!fromMatch || !destMatch || !amountMatch) continue;

      console.log('[verify] MATCH FOUND — marking payment completed');

      await supabaseServer
        .from('ton_payments')
        .update({ status: 'completed', wallet_address: walletLink.address_raw })
        .eq('id', payment.id);

      setTimeout(() => {
        void processJob(payment.job_id, payment.document_id);
      }, 0);

      return NextResponse.json({ verified: true });
    }

    console.log('[verify] no matching transaction found');
    return NextResponse.json({ verified: false });
  } catch (err) {
    console.error('[verify-ton-payment] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
