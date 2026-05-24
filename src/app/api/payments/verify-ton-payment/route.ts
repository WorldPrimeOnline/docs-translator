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

    // Look up payment record
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
      await supabaseServer
        .from('ton_payments')
        .update({ status: 'expired' })
        .eq('id', payment.id);
      return NextResponse.json({ verified: false, expired: true });
    }

    // Get user's linked wallet address
    const { data: walletLink } = await supabaseServer
      .from('wallet_links')
      .select('address_raw')
      .eq('user_id', user.id)
      .single();

    if (!walletLink) {
      return NextResponse.json({ verified: false, error: 'Wallet not linked' });
    }

    // Normalize merchant address once
    const merchantRaw = Address.parse(MERCHANT_ADDRESS).toRawString();
    const minAmount = Math.floor(Number(amountNanoton) * 0.99);
    const windowStartSec = Math.floor(now.getTime() / 1000) - 1800;

    // Query toncenter for recent incoming transactions to merchant address
    const url = new URL(TONCENTER_URL);
    url.searchParams.set('address', MERCHANT_ADDRESS);
    url.searchParams.set('limit', '50');
    const apiKey = process.env.TONCENTER_API_KEY;
    if (apiKey) url.searchParams.set('api_key', apiKey);

    const tcRes = await fetch(url.toString(), { cache: 'no-store' });
    if (!tcRes.ok) return NextResponse.json({ verified: false });

    const tcData = (await tcRes.json()) as {
      ok: boolean;
      result: Array<{
        utime: number;
        in_msg: { source: string; destination: string; value: string };
      }>;
    };
    if (!tcData.ok || !Array.isArray(tcData.result)) {
      return NextResponse.json({ verified: false });
    }

    for (const tx of tcData.result) {
      if (tx.utime < windowStartSec) continue;

      let rawFrom: string;
      let rawDest: string;
      try {
        rawFrom = Address.parse(tx.in_msg.source).toRawString();
        rawDest = Address.parse(tx.in_msg.destination).toRawString();
      } catch {
        continue;
      }

      if (rawFrom !== walletLink.address_raw) continue;
      if (rawDest !== merchantRaw) continue;
      if (Number(tx.in_msg.value) < minAmount) continue;

      // Match found — mark paid and start processing
      await supabaseServer
        .from('ton_payments')
        .update({ status: 'completed', wallet_address: walletLink.address_raw })
        .eq('id', payment.id);

      setTimeout(() => {
        void processJob(payment.job_id, payment.document_id);
      }, 0);

      return NextResponse.json({ verified: true });
    }

    return NextResponse.json({ verified: false });
  } catch (err) {
    console.error('[verify-ton-payment] error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
