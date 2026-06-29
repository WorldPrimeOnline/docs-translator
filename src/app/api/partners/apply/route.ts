import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';
import { PartnerApplicationSchema } from '@/lib/partners/schema';
import { createPartnerApplicationIssue } from '@/lib/jira/partner-client';
import type { PartnerType } from '@/lib/partners/schema';

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = PartnerApplicationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const data = parsed.data;

  const { data: inserted, error: dbError } = await supabaseServer
    .from('partner_applications')
    .insert({
      partner_type: data.partnerType as PartnerType,
      name: data.name,
      email: data.email,
      phone: data.phone || null,
      organization: data.organization || null,
      message: data.message || null,
      ref_code: data.refCode || null,
      utm_source: data.utmSource || null,
      utm_medium: data.utmMedium || null,
      utm_campaign: data.utmCampaign || null,
    })
    .select('id, created_at')
    .single();

  if (dbError || !inserted) {
    console.error('[partners/apply] DB insert error:', dbError);
    return NextResponse.json({ error: 'Failed to save application' }, { status: 500 });
  }

  // Jira issue creation is best-effort: failure must not lose the application.
  try {
    const issue = await createPartnerApplicationIssue({
      applicationId: inserted.id,
      partnerType: data.partnerType,
      name: data.name,
      organization: data.organization || null,
      message: data.message || null,
      createdAt: inserted.created_at,
    });

    if (issue) {
      await supabaseServer
        .from('partner_applications')
        .update({
          jira_issue_key: issue.issueKey,
          jira_sync_status: 'synced',
          updated_at: new Date().toISOString(),
        })
        .eq('id', inserted.id);
    }
  } catch (jiraErr) {
    console.error('[partners/apply] Jira issue creation failed (non-fatal):', jiraErr);
    await supabaseServer
      .from('partner_applications')
      .update({
        jira_sync_status: 'failed',
        jira_last_error: String(jiraErr).slice(0, 500),
        updated_at: new Date().toISOString(),
      })
      .eq('id', inserted.id);
  }

  return NextResponse.json({ ok: true, applicationId: inserted.id });
}
