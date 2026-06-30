/**
 * Tests for GET /api/partners/qr/[code]
 *
 * Returns a PNG QR code for the partner's referral link.
 * 404 if partner does not exist or is inactive.
 * 400 for invalid code format.
 * No auth required (public endpoint).
 */

jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));

jest.mock('qrcode', () => ({
  toBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-png-data')),
}));

import { NextRequest } from 'next/server';
import { GET } from '../qr/[code]/route';
import { supabaseServer } from '@/lib/supabase/server';
import QRCode from 'qrcode';

const mockFrom = supabaseServer.from as jest.Mock;
const mockToBuffer = QRCode.toBuffer as jest.Mock;

function makeRequest(code: string): NextRequest {
  return new NextRequest(`http://localhost/api/partners/qr/${code}`);
}

function mockParams(code: string) {
  return { params: Promise.resolve({ code }) };
}

function chainMaybySingle(data: unknown) {
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        maybeSingle: jest.fn().mockResolvedValue({ data, error: null }),
      }),
    }),
  };
}

const ACTIVE_PARTNER = { id: 'partner-qr-01', is_active: true, referral_code: 'MYCODE' };

beforeEach(() => jest.clearAllMocks());

describe('GET /api/partners/qr/[code]', () => {

  it('returns PNG buffer for valid active partner code', async () => {
    mockFrom.mockReturnValue(chainMaybySingle(ACTIVE_PARTNER));

    const res = await GET(makeRequest('MYCODE'), mockParams('MYCODE'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('generates QR for the production referral URL', async () => {
    mockFrom.mockReturnValue(chainMaybySingle(ACTIVE_PARTNER));

    await GET(makeRequest('MYCODE'), mockParams('MYCODE'));

    expect(mockToBuffer).toHaveBeenCalledWith(
      'https://www.wpotranslations.org/ru?ref=MYCODE',
      expect.objectContaining({ type: 'png' }),
    );
  });

  it('sets Cache-Control: public for active partner', async () => {
    mockFrom.mockReturnValue(chainMaybySingle(ACTIVE_PARTNER));

    const res = await GET(makeRequest('MYCODE'), mockParams('MYCODE'));
    const cc = res.headers.get('Cache-Control') ?? '';
    expect(cc).toContain('public');
    expect(cc).toContain('max-age=86400');
  });

  it('returns 404 for inactive partner', async () => {
    mockFrom.mockReturnValue(chainMaybySingle({ ...ACTIVE_PARTNER, is_active: false }));

    const res = await GET(makeRequest('MYCODE'), mockParams('MYCODE'));
    expect(res.status).toBe(404);
  });

  it('returns 404 when partner code does not exist', async () => {
    mockFrom.mockReturnValue(chainMaybySingle(null));

    const res = await GET(makeRequest('UNKNOWN'), mockParams('UNKNOWN'));
    expect(res.status).toBe(404);
  });

  it('returns 400 for empty code', async () => {
    const res = await GET(makeRequest(''), mockParams(''));
    expect(res.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns 400 for code with special characters', async () => {
    const res = await GET(makeRequest('BAD CODE!'), mockParams('BAD CODE!'));
    expect(res.status).toBe(400);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('normalizes code to uppercase before lookup', async () => {
    mockFrom.mockReturnValue(chainMaybySingle(ACTIVE_PARTNER));

    await GET(makeRequest('mycode'), mockParams('mycode'));

    const fromChain = mockFrom.mock.results[0]!.value as ReturnType<typeof chainMaybySingle>;
    const selectChain = (fromChain.select as jest.Mock).mock.results[0]!.value as { eq: jest.Mock };
    const eqArgs = selectChain.eq.mock.calls[0] as [string, string];
    expect(eqArgs[1]).toBe('MYCODE');
  });

  it('does not require authentication', async () => {
    mockFrom.mockReturnValue(chainMaybySingle(ACTIVE_PARTNER));

    const req = new NextRequest('http://localhost/api/partners/qr/MYCODE');
    const res = await GET(req, mockParams('MYCODE'));
    expect(res.status).toBe(200);
  });
});
