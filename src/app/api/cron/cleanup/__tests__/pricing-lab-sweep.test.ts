/**
 * Tests the new pricing-lab/ TTL sweep added to the existing daily cleanup cron.
 * Other sweeps (documents/order_drafts/raw-uploads) are neutralized via empty mock data so
 * this test isolates the pricing-lab-specific behavior.
 */
export {};

const deletedKeys: string[] = [];
let pricingLabObjects: Array<{ key: string; lastModified: Date | null; size: number }> = [];

jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: {
    from: () => ({
      select: () => ({
        lt: () => ({ limit: async () => ({ data: [], error: null }) }),
        neq: () => ({ lt: () => ({ limit: async () => ({ data: [], error: null }) }) }),
      }),
    }),
  },
}));

jest.mock('@/lib/r2/client', () => ({
  deleteFile: jest.fn(async (key: string) => { deletedKeys.push(key); }),
  listObjectsByPrefix: jest.fn(async (prefix: string) => {
    if (prefix === 'pricing-lab/') return pricingLabObjects;
    return [];
  }),
}));

jest.mock('@/lib/order-drafts/upload-constants', () => ({ RAW_UPLOAD_PREFIX: 'draft-upload-raw' }));

function makeRequest(): { headers: { get: (name: string) => string | null } } {
  return { headers: { get: (name: string) => (name === 'authorization' ? `Bearer test-cron-secret` : null) } };
}

beforeEach(() => {
  deletedKeys.length = 0;
  pricingLabObjects = [];
  process.env.CRON_SECRET = 'test-cron-secret';
  jest.resetModules();
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe('cleanup cron — pricing-lab/ TTL sweep', () => {
  it('deletes pricing-lab files older than 1 hour', async () => {
    const now = Date.now();
    pricingLabObjects = [
      { key: 'pricing-lab/user-1/old.pdf', lastModified: new Date(now - 2 * 60 * 60 * 1000), size: 100 },
    ];
    const { GET } = await import('../route');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeRequest() as any);
    const data = await res.json();

    expect(deletedKeys).toContain('pricing-lab/user-1/old.pdf');
    expect(data.pricingLabFilesDeleted).toBe(1);
  });

  it('does NOT delete pricing-lab files younger than 1 hour', async () => {
    const now = Date.now();
    pricingLabObjects = [
      { key: 'pricing-lab/user-1/fresh.pdf', lastModified: new Date(now - 5 * 60 * 1000), size: 100 },
    ];
    const { GET } = await import('../route');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET(makeRequest() as any);
    const data = await res.json();

    expect(deletedKeys).not.toContain('pricing-lab/user-1/fresh.pdf');
    expect(data.pricingLabFilesDeleted).toBe(0);
  });

  it('never touches the documents/ or draft-uploads/ prefixes via this sweep', async () => {
    const { GET } = await import('../route');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await GET(makeRequest() as any);
    expect(deletedKeys.every((k) => !k.startsWith('documents/') && !k.startsWith('draft-uploads/'))).toBe(true);
  });
});
