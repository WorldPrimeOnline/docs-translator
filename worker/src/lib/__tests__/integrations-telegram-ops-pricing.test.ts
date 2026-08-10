/**
 * @jest-environment node
 *
 * Integration-style test: confirms that the pricing engine's authoritative
 * payable page count and translator/notary payout amounts (price_quotes /
 * cost_reservations) reach the main Jira order issue's Telegram Operations fields
 * (customfield_10129/10130/10131) — not just that the pure field-builder in
 * order-fields.ts is correct (worker/src/lib/jira/__tests__/order-fields.test.ts
 * already covers that in isolation).
 *
 * 2026-08-10: explicitly approved, targeted exception to the DOCX pipeline
 * freeze's "Jira/Google Drive integration workflow" line — scoped to exactly
 * these 3 fields.
 */

export {};

const fetchCalls: Array<{ url: string; body: string | undefined }> = [];
let priceQuoteRow: { id: string; translation_page_count_exact: number | null } | null = null;
let costReservationRows: Array<{ cost_type: string; amount_kzt: number; status: string }> = [];

jest.mock('../supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'price_quotes') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: priceQuoteRow, error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'cost_reservations') {
        return {
          select: () => ({
            eq: () => ({
              neq: async (field: string, value: unknown) => ({
                data: costReservationRows.filter((r) => (r as unknown as Record<string, unknown>)[field] !== value),
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'partner_referrals' || table === 'partners') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        };
      }
      // jobs (idempotency guard + job updates) and anything else
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: null }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
      };
    },
  },
}));

jest.mock('../google-drive', () => ({
  createOrderFolder: jest.fn(),
  uploadFileToDrive: jest.fn(),
  getSubfolderId: jest.fn(),
  isDriveConfigured: () => false,
  DRIVE_SUBFOLDER_NAMES: { source: '01_SOURCE', aiDraft: '02_AI_DRAFT' },
}));

jest.mock('../r2', () => ({ downloadFile: jest.fn() }));

beforeEach(() => {
  fetchCalls.length = 0;
  priceQuoteRow = null;
  costReservationRows = [];
  process.env.JIRA_BASE_URL = 'https://wpo.atlassian.net';
  process.env.JIRA_EMAIL = 'bot@wpo.test';
  process.env.JIRA_API_TOKEN = 'test-token';

  global.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body as string | undefined;
    fetchCalls.push({ url, body });
    if (url.endsWith('/issue') && init?.method === 'POST') {
      return { ok: true, json: async () => ({ id: '10001', key: 'WO-99' }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.resetModules();
  delete process.env.JIRA_BASE_URL;
  delete process.env.JIRA_EMAIL;
  delete process.env.JIRA_API_TOKEN;
});

function issueFields(body: string): Record<string, unknown> {
  return (JSON.parse(body) as { fields: Record<string, unknown> }).fields;
}

describe('initializeOrderIntegrations — Telegram Operations pricing fields reach the main Jira issue', () => {
  // official_with_translator_signature_and_provider_stamp (not notarization_through_partners)
  // so resolveNotaryUrgencySnapshotForJob() short-circuits without any Supabase call,
  // keeping this test focused on price_quotes/cost_reservations only.
  const baseParams = {
    jobId: 'job-1',
    serviceLevel: 'official_with_translator_signature_and_provider_stamp' as const,
    sourceLang: 'ru',
    targetLang: 'zh',
    documentType: 'passport_id',
    customerId: 'user-1',
  };

  it('writes payablePageCount, translator payout, and notary payout all together', async () => {
    priceQuoteRow = { id: 'quote-1', translation_page_count_exact: 2.5 };
    costReservationRows = [
      { cost_type: 'translator_payout', amount_kzt: 4500, status: 'reserved' },
      { cost_type: 'notary_payout', amount_kzt: 6000, status: 'reserved' },
    ];

    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations(baseParams);

    const issueCreateCall = fetchCalls.find((c) => c.url.endsWith('/issue'));
    const fields = issueFields(issueCreateCall!.body!);
    expect(fields['customfield_10129']).toBe('2.5');
    expect(fields['customfield_10130']).toBe('4500');
    expect(fields['customfield_10131']).toBe('6000');
  });

  it('legacy formula: no translation_page_count_exact — field omitted, never fabricated', async () => {
    priceQuoteRow = { id: 'quote-2', translation_page_count_exact: null };
    costReservationRows = [
      { cost_type: 'translator_reserved_cost', amount_kzt: 3000, status: 'reserved' },
    ];

    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations(baseParams);

    const issueCreateCall = fetchCalls.find((c) => c.url.endsWith('/issue'));
    const fields = issueFields(issueCreateCall!.body!);
    expect(fields['customfield_10129']).toBeUndefined();
    // legacy cost_type still recognized as the translator payout
    expect(fields['customfield_10130']).toBe('3000');
    expect(fields['customfield_10131']).toBeUndefined();
  });

  it('excludes canceled cost_reservations — a canceled payout must never reach the Jira field', async () => {
    priceQuoteRow = { id: 'quote-3', translation_page_count_exact: 1 };
    costReservationRows = [
      { cost_type: 'translator_payout', amount_kzt: 999999, status: 'canceled' },
    ];

    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations(baseParams);

    const issueCreateCall = fetchCalls.find((c) => c.url.endsWith('/issue'));
    const fields = issueFields(issueCreateCall!.body!);
    expect(fields['customfield_10130']).toBeUndefined();
  });

  it('no price_quotes row at all — all 3 fields omitted, no error', async () => {
    priceQuoteRow = null;
    costReservationRows = [];

    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations(baseParams);

    const issueCreateCall = fetchCalls.find((c) => c.url.endsWith('/issue'));
    const fields = issueFields(issueCreateCall!.body!);
    expect(fields['customfield_10129']).toBeUndefined();
    expect(fields['customfield_10130']).toBeUndefined();
    expect(fields['customfield_10131']).toBeUndefined();
  });

  it('electronic order — no main Jira issue at all, pricing-fields lookup is moot', async () => {
    priceQuoteRow = { id: 'quote-4', translation_page_count_exact: 3 };
    costReservationRows = [{ cost_type: 'translator_payout', amount_kzt: 1000, status: 'reserved' }];

    const { initializeOrderIntegrations } = await import('../integrations');
    await initializeOrderIntegrations({ ...baseParams, serviceLevel: 'electronic' });

    const issueCreateCall = fetchCalls.find((c) => c.url.endsWith('/issue'));
    expect(issueCreateCall).toBeUndefined();
  });
});
