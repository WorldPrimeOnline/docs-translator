import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { getPolarClient, getPolarProductId } from '@/lib/polar/client';
import type { Database } from '@/types';

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
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = (await request.json()) as { documentId?: string; jobId?: string };
    const { documentId, jobId: bodyJobId } = body;
    if (!documentId) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 });
    }

    const { data: doc, error: docError } = await supabaseServer
      .from('documents')
      .select('id, user_id, document_type, filename')
      .eq('id', documentId)
      .single();

    if (docError) {
      console.error('[polar-checkout] document fetch error:', docError);
      return NextResponse.json({ error: 'Document fetch failed', detail: docError.message }, { status: 500 });
    }
    if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    if (doc.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Resolve jobId — use provided value or look up the queued job for this document
    let jobId = bodyJobId;
    if (!jobId) {
      const { data: job, error: jobError } = await supabaseServer
        .from('jobs')
        .select('id')
        .eq('document_id', documentId)
        .eq('status', 'queued')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (jobError) {
        console.error('[polar-checkout] job fetch error:', jobError);
        return NextResponse.json({ error: 'Job fetch failed', detail: jobError.message }, { status: 500 });
      }
      if (!job) return NextResponse.json({ error: 'No queued job found for this document' }, { status: 404 });
      jobId = job.id;
    }

    // Try to get page count from OCR results (may not exist yet at checkout time)
    const { data: ocrResult } = await supabaseServer
      .from('ocr_results')
      .select('page_count')
      .eq('job_id', jobId)
      .single();

    const pageCount = ocrResult?.page_count ?? 0;
    const productId = getPolarProductId(doc.document_type, pageCount);
    console.log('[polar-checkout] productId:', productId, 'documentType:', doc.document_type, 'pageCount:', pageCount);

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

    const checkout = await getPolarClient().checkouts.create({
      products: [productId],
      successUrl: `${baseUrl}/dashboard?payment=success&jobId=${jobId}&documentId=${documentId}`,
      metadata: {
        documentId,
        jobId,
        userId: user.id,
      },
    });

    return NextResponse.json({ checkoutUrl: checkout.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error('[polar-checkout] unhandled error:', message, stack);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
