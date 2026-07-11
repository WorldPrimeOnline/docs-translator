/**
 * Public pre-checkout draft creation — no auth required.
 * See src/lib/order-drafts/service.ts for the conversion-to-real-order path.
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createDraft } from '@/lib/order-drafts/service';
import { getOrCreateDraftSessionToken } from '@/lib/order-drafts/session';
import { getClientIp, getOptionalAuthUser } from '@/lib/order-drafts/request-context';

const VALID_SERVICE_LEVELS = [
  'electronic',
  'official_with_translator_signature_and_provider_stamp',
  'notarization_through_partners',
] as const;
// 'unknown' is intentionally not a submittable value — see upload-card/route.ts for why.
const VALID_APPLICANT_TYPES = ['individual', 'legal_entity'] as const;
const VALID_DELIVERY_ZONES = ['almaty_standard', 'remote_area', 'other_city', 'urgent_delivery'] as const;
const VALID_NOTARY_URGENCY = ['standard', 'same_day'] as const;
const VALID_FULFILLMENT = ['pickup', 'delivery'] as const;

const CreateDraftSchema = z.object({
  sourceLanguage: z.string().min(1).optional(),
  targetLanguage: z.string().min(1).optional(),
  documentType: z.string().min(1).optional(),
  outputFormat: z.string().min(1).optional(),
  serviceLevel: z.enum(VALID_SERVICE_LEVELS).optional(),
  applicantType: z.enum(VALID_APPLICANT_TYPES).optional(),
  notaryUrgencyLevel: z.enum(VALID_NOTARY_URGENCY).optional(),
  notaryCity: z.string().max(100).optional(),
  fulfillmentMethod: z.enum(VALID_FULFILLMENT).optional(),
  deliveryPhone: z.string().max(30).optional(),
  deliveryAddress: z.string().max(500).optional(),
  deliveryZone: z.enum(VALID_DELIVERY_ZONES).optional(),
  customerComment: z.string().max(2000).optional(),
  refCode: z.string().max(50).optional(),
  utmSource: z.string().max(200).optional(),
  utmMedium: z.string().max(200).optional(),
  utmCampaign: z.string().max(200).optional(),
  utmContent: z.string().max(200).optional(),
  utmTerm: z.string().max(200).optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body: unknown = await request.json().catch(() => ({}));
    const parsed = CreateDraftSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'VALIDATION_FAILED', details: parsed.error.flatten() }, { status: 400 });
    }

    const sessionToken = await getOrCreateDraftSessionToken();
    const user = await getOptionalAuthUser();
    const ip = getClientIp(request);

    const draft = await createDraft(parsed.data, sessionToken, ip);

    // Authenticated visitors get the draft attached immediately — no login detour needed later.
    if (user) {
      const { attachDraftToUser } = await import('@/lib/order-drafts/service');
      await attachDraftToUser(draft.id, user.id, sessionToken);
    }

    return NextResponse.json({ draftId: draft.id, status: draft.status });
  } catch (err) {
    console.error('[order-drafts] create failed:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
