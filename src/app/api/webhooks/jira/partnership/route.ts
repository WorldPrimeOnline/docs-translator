/**
 * POST /api/webhooks/jira/partnership
 *
 * Jira Automation → WPO partner lifecycle webhook.
 *
 * Jira Automation triggers on Partnership issue transitions:
 *   "АКТИВНОЕ ПАРТНЕРСТВО"  → create or re-activate partner  (Ё and Е both accepted)
 *   "ПАРТНЕРСТВО ОТМЕНЕНО"  → deactivate partner (preserve history)
 *   Any other status        → no-op, returns { ok: true, action: 'no_op' }
 *
 * Status matching uses normalizeStatus() which uppercases, trims, and replaces
 * Ё→Е so that Jira Automation's "АКТИВНОЕ ПАРТНЕРСТВО" and
 * "АКТИВНОЕ ПАРТНЁРСТВО" both resolve to the same canonical string.
 *
 * Authentication: X-WPO-Webhook-Secret header must equal JIRA_WEBHOOK_SECRET.
 *
 * Expected Jira Automation payload:
 * {
 *   "issue": {
 *     "key": "WPO-123",
 *     "status": "АКТИВНОЕ ПАРТНЕРСТВО",
 *     "summary": "[Partner Application] Visa Center — <applicationId>"
 *   },
 *   "partner_application_id": "<uuid>",  // optional — preferred lookup key
 *   "eventId": "<string>",               // optional — for caller-side idempotency logging
 *   "occurredAt": "<ISO timestamp>"      // optional
 * }
 *
 * Lookup order: partner_application_id from payload → jira_issue_key = issue.key.
 *
 * Default commercial settings applied on activation (overridable via application.ref_code):
 *   commission_rate = 0.05
 *   client_discount_enabled = true, type = fixed, value = 1000 ₸, min_order = 5000 ₸
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseServer } from '@/lib/supabase/server';
import {
  addPartnerActivationComment,
  addPartnerDeactivationComment,
  type PartnerActivationCommentParams,
} from '@/lib/jira/partner-client';

// ─── Constants ────────────────────────────────────────────────────────────────

const PRODUCTION_DOMAIN = 'https://www.wpotranslations.org';

// Canonical forms use Е (without Ё) — normalizeStatus() maps Ё→Е before comparison.
// Jira Automation sends "АКТИВНОЕ ПАРТНЕРСТВО" (without Ё); both variants are accepted.
const STATUS_ACTIVATE   = 'АКТИВНОЕ ПАРТНЕРСТВО';
const STATUS_DEACTIVATE = 'ПАРТНЕРСТВО ОТМЕНЕНО';

/**
 * Normalize a Jira status for comparison:
 *   1. trim whitespace
 *   2. uppercase
 *   3. replace Ё with Е (Jira may send either depending on workflow config)
 */
function normalizeStatus(s: string): string {
  return s.trim().toUpperCase().replace(/Ё/g, 'Е');
}

const DEFAULT_COMMISSION_RATE          = 0.05;
// Partners are attribution codes by default — no automatic client discount.
// Discounts must be explicitly configured per partner after activation.
const DEFAULT_DISCOUNT_ENABLED         = false;
const DEFAULT_DISCOUNT_TYPE: null      = null;
const DEFAULT_DISCOUNT_VALUE: null     = null;
const DEFAULT_DISCOUNT_MIN_ORDER: null = null;
const DEFAULT_DISCOUNT_MAX: null       = null;

// ─── Schema ───────────────────────────────────────────────────────────────────

const PayloadSchema = z.object({
  issue: z.object({
    key: z.string().min(1),
    status: z.string().min(1),
    summary: z.string().optional(),
  }),
  partner_application_id: z.string().uuid().optional(),
  eventId: z.string().optional(),
  occurredAt: z.string().optional(),
});

type Payload = z.infer<typeof PayloadSchema>;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.JIRA_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[jira/partnership] JIRA_WEBHOOK_SECRET not configured');
    return false;
  }
  return request.headers.get('x-wpo-webhook-secret') === secret;
}

function generateReferralCode(org: string | null | undefined, name: string): string {
  const base = (org ?? name)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return base ? `${base}${suffix}` : `WPO${suffix}`;
}

async function isCodeUnique(code: string): Promise<boolean> {
  const { data } = await supabaseServer
    .from('partners')
    .select('id')
    .eq('referral_code', code)
    .maybeSingle();
  return data === null;
}

async function resolveReferralCode(
  rawCode: string | null | undefined,
  org: string | null | undefined,
  name: string,
): Promise<string> {
  // Prefer explicit code from application (e.g. submitted ref_code field)
  if (rawCode) {
    const normalized = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20);
    if (normalized && await isCodeUnique(normalized)) return normalized;
    // Collision — fall through to auto-generation
  }
  // Auto-generate
  let code = generateReferralCode(org, name);
  if (await isCodeUnique(code)) return code;
  // Retry with extended suffix
  code = `${code}${Math.random().toString(36).slice(2, 3).toUpperCase()}`.slice(0, 20);
  if (await isCodeUnique(code)) return code;
  // Last resort: timestamp suffix
  code = `WPO${Date.now().toString(36).toUpperCase().slice(-6)}`;
  return code;
}

// ─── Lookup ───────────────────────────────────────────────────────────────────

type AppRow = {
  id: string;
  partner_type: string;
  name: string;
  email: string;
  organization: string | null;
  ref_code: string | null;
  status: string;
  approved_partner_id: string | null;
};

async function loadApplication(payload: Payload): Promise<AppRow | null> {
  // Preferred: explicit application ID from payload
  if (payload.partner_application_id) {
    const { data } = await supabaseServer
      .from('partner_applications')
      .select('id, partner_type, name, email, organization, ref_code, status, approved_partner_id')
      .eq('id', payload.partner_application_id)
      .maybeSingle();
    if (data) return data as AppRow;
  }
  // Fallback: find by Jira issue key stored at application creation time
  const { data } = await supabaseServer
    .from('partner_applications')
    .select('id, partner_type, name, email, organization, ref_code, status, approved_partner_id')
    .eq('jira_issue_key', payload.issue.key)
    .maybeSingle();
  return data as AppRow | null;
}

// ─── Activation ──────────────────────────────────────────────────────────────

async function activatePartner(app: AppRow, issueKey: string): Promise<NextResponse> {
  const now = new Date().toISOString();

  // If the application already has a partner record, re-activate it
  if (app.approved_partner_id) {
    // Fetch existing partner to get referral code for comment + link generation
    const { data: existingPartner } = await supabaseServer
      .from('partners')
      .select('id, referral_code, commission_rate, client_discount_enabled, client_discount_type, client_discount_value, client_discount_min_order_amount, client_discount_max_amount')
      .eq('id', app.approved_partner_id)
      .single();

    const partnerLink = existingPartner
      ? `${PRODUCTION_DOMAIN}/ru?ref=${existingPartner.referral_code}`
      : null;
    const qrCodeUrl = existingPartner
      ? `${PRODUCTION_DOMAIN}/api/partners/qr/${existingPartner.referral_code}`
      : null;

    const { error } = await supabaseServer
      .from('partners')
      .update({
        is_active: true,
        deactivated_at: null,
        deactivation_reason: null,
        ...(partnerLink ? { partner_link: partnerLink } : {}),
        ...(qrCodeUrl ? { qr_code_url: qrCodeUrl } : {}),
        updated_at: now,
      })
      .eq('id', app.approved_partner_id);

    if (error) {
      console.error('[jira/partnership] re-activate partner failed:', error.message);
      return NextResponse.json({ error: 'Failed to re-activate partner' }, { status: 500 });
    }

    // Best-effort Jira comment
    if (existingPartner) {
      try {
        const commentParams: PartnerActivationCommentParams = {
          referralCode: existingPartner.referral_code,
          partnerLink: partnerLink!,
          qrCodeUrl: qrCodeUrl!,
          commissionRate: existingPartner.commission_rate ?? DEFAULT_COMMISSION_RATE,
          clientDiscountEnabled: existingPartner.client_discount_enabled ?? DEFAULT_DISCOUNT_ENABLED,
          clientDiscountType: existingPartner.client_discount_type ?? DEFAULT_DISCOUNT_TYPE,
          clientDiscountValue: existingPartner.client_discount_value ?? DEFAULT_DISCOUNT_VALUE,
          clientDiscountMinOrderAmount: existingPartner.client_discount_min_order_amount ?? DEFAULT_DISCOUNT_MIN_ORDER,
          clientDiscountMaxAmount: existingPartner.client_discount_max_amount ?? DEFAULT_DISCOUNT_MAX,
        };
        await addPartnerActivationComment(issueKey, commentParams);
        await supabaseServer
          .from('partners')
          .update({ activation_comment_added_at: new Date().toISOString() })
          .eq('id', app.approved_partner_id);
      } catch (commentErr) {
        const sanitized = String(commentErr).replace(/https?:\/\/[^\s]+/g, '[url]').slice(0, 500);
        console.error('[jira/partnership] activation comment failed (non-fatal):', sanitized);
        await supabaseServer
          .from('partners')
          .update({ activation_comment_error: sanitized })
          .eq('id', app.approved_partner_id);
      }
    }

    console.log(`[jira/partnership] re-activated partner ${app.approved_partner_id} for app ${app.id} via ${issueKey}`);
    return NextResponse.json({ ok: true, action: 'reactivated', partnerId: app.approved_partner_id });
  }

  // Create new partner record
  const referralCode = await resolveReferralCode(app.ref_code, app.organization, app.name);

  const { data: partner, error: insertErr } = await supabaseServer
    .from('partners')
    .insert({
      application_id: app.id,
      partner_type: app.partner_type,
      name: app.name,
      email: app.email,
      organization: app.organization ?? null,
      referral_code: referralCode,
      commission_rate: DEFAULT_COMMISSION_RATE,
      is_active: true,
      client_discount_enabled: DEFAULT_DISCOUNT_ENABLED,
      client_discount_type: DEFAULT_DISCOUNT_TYPE,
      client_discount_value: DEFAULT_DISCOUNT_VALUE,
      client_discount_min_order_amount: DEFAULT_DISCOUNT_MIN_ORDER,
      client_discount_max_amount: DEFAULT_DISCOUNT_MAX,
    })
    .select('id, referral_code')
    .single();

  if (insertErr || !partner) {
    if (insertErr?.code === '23505') {
      return NextResponse.json({ error: 'Partner with this email already exists' }, { status: 409 });
    }
    console.error('[jira/partnership] partner insert failed:', insertErr?.message);
    return NextResponse.json({ error: 'Failed to create partner record' }, { status: 500 });
  }

  // Build links from the DB-confirmed referral code
  const partnerLink = `${PRODUCTION_DOMAIN}/ru?ref=${partner.referral_code}`;
  const qrCodeUrl   = `${PRODUCTION_DOMAIN}/api/partners/qr/${partner.referral_code}`;

  // Update application with approval + store partner link/QR in partners row
  const { error: appUpdateErr } = await supabaseServer
    .from('partner_applications')
    .update({
      status: 'approved',
      approved_partner_id: partner.id,
      approved_at: now,
      approved_by: 'jira-webhook',
      updated_at: now,
    })
    .eq('id', app.id);

  if (appUpdateErr) {
    console.error('[jira/partnership] application update failed (non-fatal):', appUpdateErr.message, { appId: app.id, partnerId: partner.id });
  }

  // Best-effort Jira comment
  try {
    await addPartnerActivationComment(issueKey, {
      referralCode: partner.referral_code,
      partnerLink,
      qrCodeUrl,
      commissionRate: DEFAULT_COMMISSION_RATE,
      clientDiscountEnabled: DEFAULT_DISCOUNT_ENABLED,
      clientDiscountType: DEFAULT_DISCOUNT_TYPE,
      clientDiscountValue: DEFAULT_DISCOUNT_VALUE,
      clientDiscountMinOrderAmount: DEFAULT_DISCOUNT_MIN_ORDER,
      clientDiscountMaxAmount: DEFAULT_DISCOUNT_MAX,
    });
    await supabaseServer
      .from('partners')
      .update({ partner_link: partnerLink, qr_code_url: qrCodeUrl, activation_comment_added_at: new Date().toISOString() })
      .eq('id', partner.id);
  } catch (commentErr) {
    const sanitized = String(commentErr).replace(/https?:\/\/[^\s]+/g, '[url]').slice(0, 500);
    console.error('[jira/partnership] activation comment failed (non-fatal):', sanitized);
    await supabaseServer
      .from('partners')
      .update({ partner_link: partnerLink, qr_code_url: qrCodeUrl, activation_comment_error: sanitized })
      .eq('id', partner.id);
  }

  console.log(`[jira/partnership] created partner ${partner.id} code="${partner.referral_code}" for app ${app.id} via ${issueKey}`);
  return NextResponse.json({
    ok: true,
    action: 'created',
    partnerId: partner.id,
    referralCode: partner.referral_code,
    referralLink: partnerLink,
  });
}

// ─── Deactivation ─────────────────────────────────────────────────────────────

async function deactivatePartner(app: AppRow, issueKey: string): Promise<NextResponse> {
  const now = new Date().toISOString();

  // Update application cancellation trail regardless
  await supabaseServer
    .from('partner_applications')
    .update({
      status: 'rejected',
      canceled_at: now,
      canceled_by: 'jira-webhook',
      cancellation_reason: STATUS_DEACTIVATE,
      updated_at: now,
    })
    .eq('id', app.id);

  if (!app.approved_partner_id) {
    // No partner record yet — application was never approved; just mark it canceled
    console.log(`[jira/partnership] application ${app.id} canceled (no partner record) via ${issueKey}`);
    return NextResponse.json({ ok: true, action: 'application_canceled' });
  }

  // Fetch partner to get referral code for deactivation comment
  const { data: existingPartner } = await supabaseServer
    .from('partners')
    .select('id, referral_code')
    .eq('id', app.approved_partner_id)
    .single();

  const { error } = await supabaseServer
    .from('partners')
    .update({
      is_active: false,
      deactivated_at: now,
      deactivation_reason: STATUS_DEACTIVATE,
      updated_at: now,
    })
    .eq('id', app.approved_partner_id);

  if (error) {
    console.error('[jira/partnership] deactivate partner failed:', error.message);
    return NextResponse.json({ error: 'Failed to deactivate partner' }, { status: 500 });
  }

  // Best-effort Jira deactivation comment
  if (existingPartner?.referral_code) {
    try {
      await addPartnerDeactivationComment(issueKey, existingPartner.referral_code);
    } catch (commentErr) {
      console.error('[jira/partnership] deactivation comment failed (non-fatal):', String(commentErr).slice(0, 300));
    }
  }

  console.log(`[jira/partnership] deactivated partner ${app.approved_partner_id} for app ${app.id} via ${issueKey}`);
  return NextResponse.json({ ok: true, action: 'deactivated', partnerId: app.approved_partner_id });
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // 1. Auth
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 2. Parse
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = PayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid payload', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const payload: Payload = parsed.data;
  const { issue } = payload;
  const rawStatus    = issue.status;
  const normalStatus = normalizeStatus(rawStatus);
  const lookupMethod = payload.partner_application_id ? 'partner_application_id' : 'jira_issue_key';

  // 3. No-op for unrecognized statuses
  if (normalStatus !== STATUS_ACTIVATE && normalStatus !== STATUS_DEACTIVATE) {
    console.log(JSON.stringify({
      event: 'partnership_webhook',
      issueKey: issue.key,
      rawStatus,
      normalizedStatus: normalStatus,
      action: 'no_op',
      lookupMethod,
    }));
    return NextResponse.json({ ok: true, action: 'no_op', receivedStatus: rawStatus });
  }

  const resolvedAction = normalStatus === STATUS_ACTIVATE ? 'activate' : 'deactivate';

  // 4. Load application
  const app = await loadApplication(payload);
  if (!app) {
    console.warn(JSON.stringify({
      event: 'partnership_webhook',
      issueKey: issue.key,
      rawStatus,
      normalizedStatus: normalStatus,
      action: resolvedAction,
      lookupMethod,
      error: 'application_not_found',
    }));
    return NextResponse.json({ error: 'Partner application not found' }, { status: 404 });
  }

  console.log(JSON.stringify({
    event: 'partnership_webhook',
    issueKey: issue.key,
    rawStatus,
    normalizedStatus: normalStatus,
    action: resolvedAction,
    lookupMethod,
    applicationId: app.id,
    existingPartnerId: app.approved_partner_id ?? null,
    supabaseOperationAttempted: true,
  }));

  // 5. Dispatch
  if (normalStatus === STATUS_ACTIVATE) return activatePartner(app, issue.key);
  return deactivatePartner(app, issue.key);
}
