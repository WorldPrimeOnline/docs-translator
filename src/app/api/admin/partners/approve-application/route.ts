/**
 * POST /api/admin/partners/approve-application
 *
 * Internal operator route — approves a partner_application and creates the
 * corresponding partners row. This is the ONLY way to create an active partner;
 * no public endpoint creates partner records.
 *
 * Protected by Authorization: Bearer <CRON_SECRET>.
 *
 * Body:
 *   applicationId         — uuid (required)
 *   referralCode          — string (optional; auto-generated from org/name if blank)
 *   commissionRate        — number 0–1 (default 0.05)
 *   clientDiscountEnabled — boolean (default false)
 *   clientDiscountType    — 'percent' | 'fixed' | null
 *   clientDiscountValue   — number | null
 *   clientDiscountMinOrderAmount — number | null
 *   clientDiscountMaxAmount      — number | null
 *   notes                 — string | null
 *   approvedBy            — string (operator identifier, e.g. email)
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

const BodySchema = z.object({
  applicationId:              z.string().uuid(),
  referralCode:               z.string().max(50).optional().transform((v) => v?.trim().toUpperCase() || undefined),
  commissionRate:             z.number().min(0).max(1).default(0.05),
  clientDiscountEnabled:      z.boolean().default(false),
  clientDiscountType:         z.enum(['percent', 'fixed']).nullable().default(null),
  clientDiscountValue:        z.number().nullable().default(null),
  clientDiscountMinOrderAmount: z.number().nullable().default(null),
  clientDiscountMaxAmount:    z.number().nullable().default(null),
  notes:                      z.string().max(2000).nullable().default(null),
  approvedBy:                 z.string().max(200).default('operator'),
});

/** Generate a readable uppercase referral code from org or name. */
function generateReferralCode(org: string | null, name: string): string {
  const base = (org ?? name)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return base ? `${base}${suffix}` : `WPO${suffix}`;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
  }

  const {
    applicationId,
    referralCode: providedCode,
    commissionRate,
    clientDiscountEnabled,
    clientDiscountType,
    clientDiscountValue,
    clientDiscountMinOrderAmount,
    clientDiscountMaxAmount,
    notes,
    approvedBy,
  } = parsed.data;

  // 1. Load application — must exist and not already approved/rejected
  const { data: application, error: appError } = await supabaseServer
    .from('partner_applications')
    .select('id, partner_type, name, email, organization, status, approved_partner_id')
    .eq('id', applicationId)
    .maybeSingle();

  if (appError) {
    console.error('[admin/approve] DB error loading application:', appError.message);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
  if (!application) {
    return NextResponse.json({ error: 'Application not found' }, { status: 404 });
  }
  if (application.status === 'approved' && application.approved_partner_id) {
    return NextResponse.json({ error: 'Application already approved', partnerId: application.approved_partner_id }, { status: 409 });
  }
  if (application.status === 'rejected') {
    return NextResponse.json({ error: 'Application is rejected — cannot approve' }, { status: 409 });
  }

  // 2. Resolve referral code
  let referralCode = providedCode ?? generateReferralCode(application.organization, application.name);

  // 3. Check code uniqueness; retry once if auto-generated code collides
  const checkUnique = async (code: string): Promise<boolean> => {
    const { data } = await supabaseServer
      .from('partners')
      .select('id')
      .eq('referral_code', code)
      .maybeSingle();
    return data === null;
  };

  if (!(await checkUnique(referralCode))) {
    if (providedCode) {
      // Operator-specified code — return error, let them choose a different one
      return NextResponse.json(
        { error: `Referral code "${referralCode}" already exists. Choose a different code.` },
        { status: 409 },
      );
    }
    // Auto-generated — append extra suffix and retry once
    const suffix2 = Math.random().toString(36).slice(2, 4).toUpperCase();
    referralCode = `${referralCode}${suffix2}`.slice(0, 20);
    if (!(await checkUnique(referralCode))) {
      return NextResponse.json({ error: 'Failed to generate unique referral code. Please provide one manually.' }, { status: 409 });
    }
  }

  // 4. Create partner record
  const { data: partner, error: partnerError } = await supabaseServer
    .from('partners')
    .insert({
      partner_type: application.partner_type,
      name: application.name,
      email: application.email,
      organization: application.organization ?? null,
      referral_code: referralCode,
      commission_rate: commissionRate,
      is_active: true,
      client_discount_enabled: clientDiscountEnabled,
      client_discount_type: clientDiscountType,
      client_discount_value: clientDiscountValue,
      client_discount_min_order_amount: clientDiscountMinOrderAmount,
      client_discount_max_amount: clientDiscountMaxAmount,
      notes: notes ?? null,
      application_id: applicationId,
    })
    .select('id, referral_code, commission_rate, is_active')
    .single();

  if (partnerError || !partner) {
    // email unique violation
    if (partnerError?.code === '23505') {
      return NextResponse.json(
        { error: 'A partner with this email already exists.' },
        { status: 409 },
      );
    }
    console.error('[admin/approve] partner insert failed:', partnerError?.message);
    return NextResponse.json({ error: 'Failed to create partner record' }, { status: 500 });
  }

  // 5. Update application status
  const { error: updateError } = await supabaseServer
    .from('partner_applications')
    .update({
      status: 'approved',
      approved_partner_id: partner.id,
      approved_at: new Date().toISOString(),
      approved_by: approvedBy,
      updated_at: new Date().toISOString(),
    })
    .eq('id', applicationId);

  if (updateError) {
    // Partner created but application update failed — log and continue (non-fatal)
    console.error('[admin/approve] application update failed (non-fatal):', updateError.message, { applicationId, partnerId: partner.id });
  }

  console.log(`[admin/approve] application ${applicationId} approved → partner ${partner.id} code="${referralCode}" by ${approvedBy}`);

  return NextResponse.json({
    partnerId: partner.id,
    referralCode: partner.referral_code,
    commissionRate: partner.commission_rate,
    isActive: partner.is_active,
    referralLink: `/ru?ref=${partner.referral_code}`,
    clientDiscountEnabled,
  });
}
