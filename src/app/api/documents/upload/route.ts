import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { uploadFile } from '@/lib/r2/client';
import { convertToPdf, mergePdfs } from '@/lib/convert-to-pdf';
import { processJob } from '@/lib/jobs/processor';
import { SUBSCRIPTION_PLANS } from '@/lib/subscriptions/config';
import { deriveBackcompatBooleans } from '@/lib/translation-workflow/output-plan';
import { isValidNotaryCity } from '@/lib/notary/cities';
import { initializeOrderIntegrations } from '@/lib/integrations/workflow';
import type { Database } from '@/types';
import type { ServiceLevel } from '@/lib/translation-prompts/types';

const MAX_FILE_SIZE_EACH = 25 * 1024 * 1024;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;

const VALID_SERVICE_LEVELS = [
  'electronic',
  'official_with_translator_signature_and_provider_stamp',
  'notarization_through_partners',
] as const;

/**
 * Zod schema for upload request validation.
 * Parsed from FormData fields (all values are strings).
 */
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
      // City is required and must be in the configured list
      if (!data.notaryCity) {
        ctx.addIssue({ code: 'custom', path: ['notaryCity'], message: 'City is required for notarization orders' });
      } else if (
        // Only validate if cities list is populated
        isValidNotaryCity !== undefined &&
        typeof isValidNotaryCity === 'function' &&
        // Skip validation if the list is empty (not yet configured)
        // See src/lib/notary/cities.ts
        (() => {
          try { return isValidNotaryCity(data.notaryCity!); }
          catch { return true; }
        })() === false
      ) {
        ctx.addIssue({ code: 'custom', path: ['notaryCity'], message: 'City not supported for notarization' });
      }

      if (!data.fulfillmentMethod) {
        ctx.addIssue({ code: 'custom', path: ['fulfillmentMethod'], message: 'Fulfillment method is required for notarization orders' });
      }

      if (data.fulfillmentMethod === 'delivery') {
        if (!data.deliveryPhone) {
          ctx.addIssue({ code: 'custom', path: ['deliveryPhone'], message: 'Phone is required for delivery' });
        }
        if (!data.deliveryAddress) {
          ctx.addIssue({ code: 'custom', path: ['deliveryAddress'], message: 'Delivery address is required for delivery' });
        }
      }
    }
  });

/**
 * Extract client IP from request headers.
 * Used for fraud prevention and payment dispute/chargeback evidence only.
 */
function getClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip')?.trim() ?? null;
}

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

    if (rawFiles.length === 0)
      return NextResponse.json({ error: 'At least one file is required' }, { status: 400 });

    for (const f of rawFiles) {
      const mime = detectMimeType(f);
      if (!ALLOWED_MIME_TYPES[mime])
        return NextResponse.json({ error: `Unsupported file type: ${f.name}. Only PDF, PNG, JPG, DOCX are accepted.` }, { status: 400 });
      if (f.size > MAX_FILE_SIZE_EACH)
        return NextResponse.json({ error: `File "${f.name}" exceeds 25 MB limit` }, { status: 400 });
    }

    const totalSize = rawFiles.reduce((s, f) => s + f.size, 0);
    if (totalSize > MAX_TOTAL_SIZE)
      return NextResponse.json({ error: 'Total file size exceeds 50 MB limit' }, { status: 400 });

    // Parse and validate form fields
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
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const {
      sourceLang,
      targetLang,
      documentType,
      serviceLevel,
      notaryCity,
      fulfillmentMethod,
      deliveryPhone,
      deliveryAddress,
    } = parsed.data;

    // Derive backward-compat booleans
    const { notarized } = deriveBackcompatBooleans(serviceLevel as ServiceLevel);

    // Convert each file to PDF then merge
    const pdfParts = await Promise.all(
      rawFiles.map(async (f) => {
        const mime = detectMimeType(f);
        const buf = Buffer.from(await f.arrayBuffer());
        return convertToPdf(buf, mime);
      }),
    );
    const pdfBuffer = await mergePdfs(pdfParts);

    const firstName = rawFiles[0]!.name.replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 200);
    const safeFilename = rawFiles.length === 1
      ? firstName
      : `${rawFiles.length}_files_${firstName}`;

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

    const clientIp = getClientIp(request);

    console.log('[upload] inserting document record:', docId);
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
      console.error('[upload] document insert failed — code:', docError?.code, 'message:', docError?.message);
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
            notarized,
            service_level: serviceLevel,
            notary_city: notaryCity ?? null,
            fulfillment_method: fulfillmentMethod ?? null,
            delivery_phone: deliveryPhone ?? null,
            delivery_address: deliveryAddress ?? null,
          })
          .select()
          .single();

        if (jobError || !job) {
          console.error('[upload] job insert failed (subscription path):', jobError);
          return NextResponse.json({ error: 'Failed to create job' }, { status: 500 });
        }

        // Audit: job created
        await supabaseServer.from('job_audit_log').insert({
          job_id: job.id,
          actor: user.id,
          source: 'upload',
          action: 'job_created',
          new_status: 'queued',
          metadata: { serviceLevel, notaryCity: notaryCity ?? null, fulfillmentMethod: fulfillmentMethod ?? null },
        }).then(({ error: e }) => { if (e) console.error('[upload] audit insert failed:', e.message); });

        // Initialize Jira + Drive integrations for certified/notarized orders (fire-and-forget)
        if (serviceLevel !== 'electronic') {
          const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://wpotranslations.org';
          void initializeOrderIntegrations({
            jobId: job.id,
            serviceLevel: serviceLevel as ServiceLevel,
            sourceLang,
            targetLang,
            documentType,
            notaryCity: notaryCity ?? null,
            fulfillmentMethod: fulfillmentMethod as 'pickup' | 'delivery' | undefined,
            siteUrl,
            sourceFileKey: fileKey,
          }).catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[upload] integration init failed (non-fatal):', msg);
          });
        }

        // Web processor handles html-format subscription jobs only
        const [, outputFmt] = (documentType as string).split('|');
        if (!outputFmt || outputFmt === 'html') {
          setTimeout(() => {
            void processJob(job.id, doc.id);
          }, 0);
        }

        const remainingDocs = sub.documents_limit - sub.documents_used - 1;
        return NextResponse.json({
          jobId: job.id,
          documentId: doc.id,
          paidViaSubscription: true,
          subscriptionPlan: sub.plan,
          remainingDocs,
          serviceLevel,
        });
      }
    }

    const limitReached = subResult && !subResult.hasCapacity;
    return NextResponse.json(
      {
        error: limitReached
          ? 'Subscription document limit reached'
          : 'No active subscription — payment method unavailable',
      },
      { status: 402 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[upload] unhandled error:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
