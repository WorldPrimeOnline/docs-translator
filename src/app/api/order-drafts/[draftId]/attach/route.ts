import { NextRequest, NextResponse } from 'next/server';
import { attachDraftToUser } from '@/lib/order-drafts/service';
import { getDraftSessionToken } from '@/lib/order-drafts/session';
import { getOptionalAuthUser } from '@/lib/order-drafts/request-context';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ draftId: string }> }): Promise<NextResponse> {
  try {
    const { draftId } = await params;
    const user = await getOptionalAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sessionToken = await getDraftSessionToken();
    const result = await attachDraftToUser(draftId, user.id, sessionToken);
    if (!result.ok) {
      const status = result.error === 'DRAFT_NOT_FOUND' ? 404 : result.error === 'SESSION_MISMATCH' || result.error === 'DRAFT_OWNED_BY_ANOTHER_USER' ? 403 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ draft: result.value });
  } catch (err) {
    console.error('[order-drafts] attach failed:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
