/**
 * Card-payment upload route.
 * Creates document + job in payment_pending state without consuming subscription quota.
 * Returns job ID and price so the frontend can initiate Halyk ePay payment.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { uploadFile } from '@/lib/r2/client';
import { convertToPdf, mergePdfs } from '@/lib/convert-to-pdf';
import { deriveBackcompatBooleans } from '@/lib/translation-workflow/output-plan';
import { isValidNotaryCity } from '@/lib/notary/cities';
import { getHalykConfig } from '@/lib/payments/halyk/config';
import { getPriceKzt } from '@/lib/payments/halyk/pricing';
import type { Database } from '@/types';
import type { ServiceLevel } from '@/lib/translation-prompts/types';

const MAX_FILE_SIZE_EACH = 25 * 1024 * 1024;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;

const VALID_SERVICE_LEVELS = [
  'electronic',
  'official_with_translator_signature_and_provider_stamp',
  'notarization_through_partners',
] as const;

const UploadFormSchema = z
  .object({
    sourceLang: z.string().min(1),
    targetLang: z.string().min(1),
    documentType: z.string().min(1),
    serviceLevel: z.enum(VALID_SERVICE_LEVELS).default('electronic'),
    notaryCity: z.string().optional(),
    fulfillmentMethod: z.enum(['pickup', 'delivery']).optional(),
    deliveryPhone: z.string().max(30).optional(),
    deliveryAddress: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.serviceLevel === 'notarization_through_partners') {
      if (!data.notaryCity) {
        ctx.addIssue({ code: 'custom', path: ['notaryCity'], message: 'City is required for notarization orders' });
      } else if (
        typeof isValidNotaryCity === 'function' &&
        (() => {
          try { return isValidNotaryCity(data.notaryCity!); }
          catch { return true; }
        })() === false
      ) {
        ctx.addIssue({ code: 'custom', path: ['notaryCity'], message: 'City not supported for notarization' });
      }
      if (!data.fulfillmentMethod) {
        ctx.addIssue({ code: 'custom', path: ['fulfillmentMethod'], message: 'Fulfillment method is required' });
      }
      if (data.fulfillmentMethod === 'delivery') {
        if (!data.deliveryPhone) ctx.addIssue({ code: 'custom', path: ['deliveryPhone'], message: 'Phone is required for delivery' });
        if (!data.deliveryAddress) ctx.addIssue({ code: 'custom', path: ['deliveryAddress'], message: 'Address is required for delivery' });
      }
    }
  });

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

function getClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() ?? null;
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
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    return await handlePost(request);
  } catch (err) {
    console.error('[upload-card] unhandled error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

async function handlePost(request: NextRequest): Promise<NextResponse> {
  const config = getHalykConfig();
  if (!config.enabled) {
    return NextResponse.json(
      { error: 'Card payments are not available at this time' },
      { status: 503 },
    );
  }

  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: userRow } = await supabaseServer
    .from('users')
    .select('terms_accepted_at')
    .eq('id', user.id)
    .maybeSingle();

  if (!userRow?.terms_accepted_at) {
    return NextResponse.json({ error: 'Terms not accepted' }, { status: 403 });
  }

  const formData = await request.formData();
  const rawFiles = formData.getAll('file').filter((f): f is File => f instanceof File);

  if (rawFiles.length === 0) {
    return NextResponse.json({ error: 'At least one file is required' }, { status: 400 });
  }

  for (const f of rawFiles) {
    const mime = detectMimeType(f);
    if (!ALLOWED_MIME_TYPES[mime]) {
      return NextResponse.json({ error: `Unsupported file type: ${f.name}` }, { status: 400 });
    }
    if (f.size > MAX_FILE_SIZE_EACH) {
      return NextResponse.json({ error: `File "${f.name}" exceeds 25 MB limit` }, { status: 400 });
    }
  }

  const totalSize = rawFiles.reduce((s, f) => s + f.size, 0);
  if (totalSize > MAX_TOTAL_SIZE) {
    return NextResponse.json({ error: 'Total file size exceeds 50 MB' }, { status: 400 });
  }

  const parsed = UploadFormSchema.safeParse({
    sourceLang: formData.get('sourceLang'),
    targetLang: formData.get('targetLang'),
    documentType: formData.get('documentType'),
    serviceLevel: formData.get('serviceLevel') ?? 'electronic',
    notaryCity: formData.get('notaryCity') ?? undefined,
    fulfillmentMethod: formData.get('fulfillmentMethod') ?? undefined,
    deliveryPhone: formData.get('deliveryPhone') ?? undefined,
    deliveryAddress: formData.get('deliveryAddress') ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }

  const { sourceLang, targetLang, documentType, serviceLevel, notaryCity, fulfillmentMethod, deliveryPhone, deliveryAddress } = parsed.data;
  const { notarized } = deriveBackcompatBooleans(serviceLevel as ServiceLevel);

  // Convert and merge files
  console.log('[upload-card] step: converting files', rawFiles.length, 'file(s)');
  const pdfParts = await Promise.all(
    rawFiles.map(async (f) => {
      const mime = detectMimeType(f);
      const buf = Buffer.from(await f.arrayBuffer());
      return convertToPdf(buf, mime);
    }),
  );
  const pdfBuffer = await mergePdfs(pdfParts);
  console.log('[upload-card] step: pdf ready', pdfBuffer.length, 'bytes');

  const firstName = rawFiles[0]!.name.replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 200);
  const safeFilename = rawFiles.length === 1 ? firstName : `${rawFiles.length}_files_${firstName}`;

  const docId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();
  const fileKey = `documents/${user.id}/${docId}/original.pdf`;
  const clientIp = getClientIp(request);

  console.log('[upload-card] step: uploading to R2', fileKey);
  await uploadFile(fileKey, pdfBuffer, 'application/pdf');
  console.log('[upload-card] step: R2 upload done');

  // Rate limit: same 10 uploads/hour per user
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await supabaseServer
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .gte('created_at', oneHourAgo);

  if (recentCount !== null && recentCount >= 10) {
    return NextResponse.json({ error: 'Too many uploads. Please wait before uploading again.' }, { status: 429 });
  }

  await supabaseServer
    .from('users')
    .upsert({ id: user.id, email: user.email ?? '' }, { onConflict: 'id', ignoreDuplicates: true });

  const { data: doc, error: docError } = await supabaseServer
    .from('documents')
    .insert({
      id: docId,
      user_id: user.id,
      filename: safeFilename,
      original_file_size: totalSize,
      file_key: fileKey,
      source_language: sourceLang,
      target_language: targetLang,
      document_type: documentType,
      status: 'processing',
      ip_address: clientIp,
    })
    .select()
    .single();

  if (docError || !doc) {
    console.error('[upload-card] document insert failed', {
      correlationId,
      code: docError?.code,
      message: docError?.message,
      details: docError?.details,
      hint: docError?.hint,
    });
    return NextResponse.json({ error: 'Failed to create document record' }, { status: 500 });
  }

  // Calculate price in KZT
  const priceKzt = getPriceKzt(serviceLevel as ServiceLevel);

  const { data: job, error: jobError } = await supabaseServer
    .from('jobs')
    .insert({
      document_id: doc.id,
      status: 'payment_pending',
      progress_percent: 0,
      priority: 0,
      payment_source: 'card_payment',
      notarized,
      service_level: serviceLevel,
      notary_city: notaryCity ?? null,
      fulfillment_method: fulfillmentMethod ?? null,
      delivery_phone: deliveryPhone ?? null,
      delivery_address: deliveryAddress ?? null,
      price_kzt: priceKzt,
    })
    .select()
    .single();

  if (jobError || !job) {
    console.error('[upload-card] job insert failed', {
      correlationId,
      code: jobError?.code,
      message: jobError?.message,
      details: jobError?.details,
      hint: jobError?.hint,
    });
    // Compensation: mark orphaned document as failed so it doesn't clog the dashboard
    await supabaseServer
      .from('documents')
      .update({ status: 'failed' })
      .eq('id', docId);
    return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
  }

  await supabaseServer.from('job_audit_log').insert({
    job_id: job.id,
    actor: user.id,
    source: 'upload-card',
    action: 'job_created',
    new_status: 'payment_pending',
    metadata: { serviceLevel, priceKzt, notaryCity: notaryCity ?? null },
  }).then(({ error: e }) => { if (e) console.error('[upload-card] audit insert failed:', e.message); });

  return NextResponse.json({
    jobId: job.id,
    documentId: doc.id,
    priceKzt,
    currency: 'KZT',
    paymentRequired: true,
  });
}
