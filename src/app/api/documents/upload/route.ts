import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { uploadFile } from '@/lib/r2/client';
import { convertToPdf } from '@/lib/convert-to-pdf';
import { processJob } from '@/lib/jobs/processor';
import { SUBSCRIPTION_PLANS } from '@/lib/subscriptions/config';
import type { Database } from '@/types';

const MAX_FILE_SIZE = 25 * 1024 * 1024;

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

function detectMimeType(file: File): string {
  if (file.type && ALLOWED_MIME_TYPES[file.type]) return file.type;
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return file.type;
}

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

async function getActiveSubscription(userId: string) {
  const { data: sub } = await supabaseServer
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!sub) return null;
  if (sub.documents_used >= sub.documents_limit) return { sub, hasCapacity: false };
  return { sub, hasCapacity: true };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const formData = await request.formData();
    const file = formData.get('file');
    const sourceLang = formData.get('sourceLang');
    const targetLang = formData.get('targetLang');
    const documentType = formData.get('documentType');
    const country = formData.get('country');
    const notarized = formData.get('notarized') === 'true';
    const bureauStamp = formData.get('bureauStamp') === 'true';
    const outputFormat = (formData.get('outputFormat') as string) || 'pdf';

    if (!(file instanceof File))
      return NextResponse.json({ error: 'file is required' }, { status: 400 });

    const mimeType = detectMimeType(file);
    if (!ALLOWED_MIME_TYPES[mimeType]) {
      return NextResponse.json(
        { error: 'Only PDF, PNG, JPG, and DOCX files are accepted' },
        { status: 400 },
      );
    }
    if (file.size > MAX_FILE_SIZE)
      return NextResponse.json({ error: 'File exceeds 25 MB limit' }, { status: 400 });
    if (
      typeof sourceLang !== 'string' ||
      typeof targetLang !== 'string' ||
      typeof documentType !== 'string'
    )
      return NextResponse.json(
        { error: 'sourceLang, targetLang, documentType are required' },
        { status: 400 },
      );

    const safeFilename = file.name.replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 200);
    const rawBuffer = Buffer.from(await file.arrayBuffer());
    const pdfBuffer = await convertToPdf(rawBuffer, mimeType);

    const docId = crypto.randomUUID();
    const fileKey = `documents/${user.id}/${docId}/original.pdf`;

    console.log('[upload] uploading to R2:', fileKey, `(${pdfBuffer.length} bytes)`);
    await uploadFile(fileKey, pdfBuffer, 'application/pdf');

    // Per-user rate limit: max 10 uploads per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await supabaseServer
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', oneHourAgo);

    if (recentCount !== null && recentCount >= 10) {
      return NextResponse.json(
        { error: 'Too many uploads. Please wait before uploading again.' },
        { status: 429 },
      );
    }

    // Ensure a public.users row exists — auth.users and public.users are separate tables.
    // Without this, the FK on documents.user_id fails for users who signed up before
    // the row was synced, or if no trigger is configured.
    console.log('[upload] upserting user:', user.id, user.email);
    const { error: userUpsertError } = await supabaseServer
      .from('users')
      .upsert(
        { id: user.id, email: user.email ?? '' },
        { onConflict: 'id', ignoreDuplicates: true },
      );
    if (userUpsertError) {
      console.error('[upload] user upsert failed:', userUpsertError);
    }

    console.log('[upload] inserting document record:', docId);
    const { data: doc, error: docError } = await supabaseServer
      .from('documents')
      .insert({
        id: docId,
        user_id: user.id,
        filename: safeFilename,
        original_file_size: file.size,
        file_key: fileKey,
        source_language: sourceLang,
        target_language: targetLang,
        document_type: documentType,
        output_format: outputFormat,
        status: 'processing',
      })
      .select()
      .single();

    if (docError || !doc) {
      console.error('[upload] document insert failed — code:', docError?.code, 'message:', docError?.message, 'details:', docError?.details, 'hint:', docError?.hint);
      return NextResponse.json(
        { error: 'Failed to create document record', detail: docError?.message },
        { status: 500 },
      );
    }
    console.log('[upload] document created:', doc.id);

    const subResult = await getActiveSubscription(user.id);

    if (subResult && subResult.hasCapacity) {
      const { sub } = subResult;
      const planConfig = SUBSCRIPTION_PLANS[sub.plan as keyof typeof SUBSCRIPTION_PLANS];
      const priority = planConfig?.priority ?? 0;

      const { error: subUpdateErr } = await supabaseServer
        .from('subscriptions')
        .update({ documents_used: sub.documents_used + 1 })
        .eq('id', sub.id);

      if (subUpdateErr) {
        console.error('[upload] subscription documents_used update failed:', subUpdateErr);
      } else {
        const { data: job, error: jobError } = await supabaseServer
          .from('jobs')
          .insert({
            document_id: doc.id,
            status: 'queued',
            progress_percent: 0,
            priority,
            payment_source: 'subscription',
            country: typeof country === 'string' ? country : null,
            notarized,
            bureau_stamp: bureauStamp,
          })
          .select()
          .single();

        if (jobError || !job) {
          console.error('[upload] job insert failed (subscription path):', jobError);
          return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
        }

        setTimeout(() => {
          void processJob(job.id, doc.id);
        }, 0);

        const remainingDocs = sub.documents_limit - sub.documents_used - 1;
        return NextResponse.json({
          jobId: job.id,
          documentId: doc.id,
          paidViaSubscription: true,
          subscriptionPlan: sub.plan,
          remainingDocs,
        });
      }
    }

    const limitReached = subResult && !subResult.hasCapacity;

    const { data: job, error: jobError } = await supabaseServer
      .from('jobs')
      .insert({
        document_id: doc.id,
        status: 'queued',
        progress_percent: 0,
        priority: 0,
        payment_source: 'ton_payment',
        country: typeof country === 'string' ? country : null,
        notarized,
        bureau_stamp: bureauStamp,
      })
      .select()
      .single();

    if (jobError || !job) {
      console.error('[upload] job insert failed:', jobError);
      return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
    }

    return NextResponse.json({
      jobId: job.id,
      documentId: doc.id,
      paidViaSubscription: false,
      limitReached: limitReached ?? false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[upload] unhandled error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
