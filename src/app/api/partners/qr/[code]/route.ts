/**
 * GET /api/partners/qr/[code]
 *
 * Public endpoint — no auth required.
 * Returns a PNG QR code for the partner's referral link.
 * Returns 404 if the partner code does not exist or is inactive.
 *
 * Cache-Control: public, max-age=86400 — QR codes are stable for active partners.
 */
import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { supabaseServer } from '@/lib/supabase/server';

const PRODUCTION_DOMAIN = 'https://www.wpotranslations.org';
const QR_SIZE = 400;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
): Promise<NextResponse> {
  const { code } = await params;

  if (!code || !/^[A-Z0-9]{3,20}$/.test(code.toUpperCase())) {
    return NextResponse.json({ error: 'Invalid code format' }, { status: 400 });
  }

  const { data: partner } = await supabaseServer
    .from('partners')
    .select('id, is_active, referral_code')
    .eq('referral_code', code.toUpperCase())
    .maybeSingle();

  if (!partner || !partner.is_active) {
    return NextResponse.json({ error: 'Partner not found or inactive' }, { status: 404 });
  }

  const referralUrl = `${PRODUCTION_DOMAIN}/ru?ref=${partner.referral_code}`;

  const buffer = await QRCode.toBuffer(referralUrl, {
    type: 'png',
    width: QR_SIZE,
    margin: 2,
    errorCorrectionLevel: 'M',
  });

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
      'Content-Length': String(buffer.length),
    },
  });
}
