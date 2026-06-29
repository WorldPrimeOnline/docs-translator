/**
 * GET /api/admin/partners/applications
 *
 * Internal operator route — lists partner applications awaiting approval.
 * Protected by Authorization: Bearer <CRON_SECRET> (same secret as cron routes).
 *
 * Returns: pending and reviewing applications with their Jira issue links.
 */
import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: applications, error } = await supabaseServer
    .from('partner_applications')
    .select(
      'id, partner_type, name, email, organization, phone, message, ref_code, status, jira_issue_key, jira_issue_url, approved_partner_id, approved_at, approved_by, created_at',
    )
    .in('status', ['pending', 'reviewing'])
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[admin/partners/applications] DB error:', error.message);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  return NextResponse.json({ applications: applications ?? [] });
}
