import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDraftRow, updateDraftFields } from '@/lib/order-drafts/service';
import { getDraftSessionToken } from '@/lib/order-drafts/session';
import { getOptionalAuthUser } from '@/lib/order-drafts/request-context';

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

const UpdateDraftSchema = z.object({
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
  consentAccepted: z.boolean().optional(),
  refCode: z.string().max(50).optional(),
  utmSource: z.string().max(200).optional(),
  utmMedium: z.string().max(200).optional(),
  utmCampaign: z.string().max(200).optional(),
  utmContent: z.string().max(200).optional(),
  utmTerm: z.string().max(200).optional(),
});

async function resolveOwner() {
  const [sessionToken, user] = await Promise.all([getDraftSessionToken(), getOptionalAuthUser()]);
  return { sessionToken, userId: user?.id ?? null };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ draftId: string }> }): Promise<NextResponse> {
  const { draftId } = await params;
  const draft = await getDraftRow(draftId);
  if (!draft) return NextResponse.json({ error: 'DRAFT_NOT_FOUND' }, { status: 404 });

  const owner = await resolveOwner();
  const owned = draft.user_id ? draft.user_id === owner.userId : draft.anonymous_session_id === owner.sessionToken;
  if (!owned) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });

  return NextResponse.json({ draft });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ draftId: string }> }): Promise<NextResponse> {
  const { draftId } = await params;
  const body: unknown = await request.json().catch(() => ({}));
  const parsed = UpdateDraftSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'VALIDATION_FAILED', details: parsed.error.flatten() }, { status: 400 });
  }

  const owner = await resolveOwner();
  const result = await updateDraftFields(draftId, parsed.data, owner);
  if (!result.ok) {
    const status = result.error === 'DRAFT_NOT_FOUND' ? 404 : result.error === 'FORBIDDEN' ? 403 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ draft: result.value });
}
