import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { stripe } from '@/lib/stripe/client';
import { supabaseServer } from '@/lib/supabase/server';
import type { Database } from '@/types';

const DOC_TYPE_LABELS: Record<string, string> = {
  passport: 'Passport / ID Card Translation',
  diploma: 'Diploma / Transcript Translation',
  contract: 'Contract Translation',
  bank_statement: 'Bank Statement Translation',
  medical: 'Medical Record Translation',
  employment: 'Employment Contract Translation',
  police_clearance: 'Police Clearance Certificate Translation',
  driver_license: "Driver's License Translation",
  other: 'Document Translation',
};

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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json()) as { documentId?: string };
  const { documentId } = body;
  if (!documentId) return NextResponse.json({ error: 'documentId is required' }, { status: 400 });

  const { data: doc, error: docError } = await supabaseServer
    .from('documents')
    .select('id, user_id, document_type, filename')
    .eq('id', documentId)
    .single();

  if (docError || !doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
  if (doc.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { data: job } = await supabaseServer
    .from('jobs')
    .select('id')
    .eq('document_id', documentId)
    .eq('status', 'queued')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!job) return NextResponse.json({ error: 'No queued job found for this document' }, { status: 404 });

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const label = DOC_TYPE_LABELS[doc.document_type] ?? 'Document Translation';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: 999,
          product_data: {
            name: label,
            description: doc.filename,
          },
        },
      },
    ],
    success_url: `${baseUrl}/dashboard?payment=success&jobId=${job.id}&documentId=${documentId}`,
    cancel_url: `${baseUrl}/dashboard?payment=cancelled`,
    metadata: { documentId, jobId: job.id, userId: user.id },
  });

  return NextResponse.json({ checkoutUrl: session.url });
}
