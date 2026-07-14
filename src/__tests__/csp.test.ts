/**
 * Tests for the Content-Security-Policy `connect-src` directive in next.config.ts —
 * specifically the direct-to-R2 upload origin needed for presigned PUT uploads
 * (src/lib/r2/client.ts's getPresignedPutUrl). Must be derived from server-side R2
 * config, never a wildcard, and must never leak credentials into the header.
 */
const ORIGINAL_ENV = process.env;

function loadConfig(): { headers: () => Promise<Array<{ headers: Array<{ key: string; value: string }> }>> } {
  jest.resetModules();
  // Dynamic re-require after jest.resetModules() is required to pick up fresh process.env per test.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('../../next.config');
  return (mod.default ?? mod) as { headers: () => Promise<Array<{ headers: Array<{ key: string; value: string }> }>> };
}

async function getCsp(): Promise<string> {
  const config = loadConfig();
  const headerGroups = await config.headers();
  const cspHeader = headerGroups[0]!.headers.find((h) => h.key === 'Content-Security-Policy');
  if (!cspHeader) throw new Error('Content-Security-Policy header not found');
  return cspHeader.value;
}

function connectSrcOf(csp: string): string {
  const directive = csp.split('; ').find((d) => d.startsWith('connect-src'));
  if (!directive) throw new Error('connect-src directive not found');
  return directive;
}

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('CSP connect-src — direct-to-R2 upload origin', () => {
  it('includes the exact staging R2 origin derived from R2_ACCOUNT_ID + R2_BUCKET_NAME', async () => {
    process.env.R2_ACCOUNT_ID = '21d94e20a98213d7829ef68f720afcc5';
    process.env.R2_BUCKET_NAME = 'wpo-staging-documents';

    const connectSrc = connectSrcOf(await getCsp());

    expect(connectSrc).toContain('https://wpo-staging-documents.21d94e20a98213d7829ef68f720afcc5.r2.cloudflarestorage.com');
  });

  it('produces a different origin for a different bucket/account, proving it is derived from env config rather than hardcoded', async () => {
    process.env.R2_ACCOUNT_ID = 'prod-account-id-example';
    process.env.R2_BUCKET_NAME = 'wpo-prod-documents';

    const connectSrc = connectSrcOf(await getCsp());

    expect(connectSrc).toContain('https://wpo-prod-documents.prod-account-id-example.r2.cloudflarestorage.com');
    expect(connectSrc).not.toContain('wpo-staging-documents');
    expect(connectSrc).not.toContain('21d94e20a98213d7829ef68f720afcc5');
  });

  it('never uses a wildcard in connect-src', async () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_BUCKET_NAME = 'bucket';

    const connectSrc = connectSrcOf(await getCsp());

    expect(connectSrc).not.toMatch(/(^|\s)\*(\s|$)/);
  });

  it('never includes R2 access key / secret values in the CSP header', async () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_BUCKET_NAME = 'bucket';
    process.env.R2_ACCESS_KEY_ID = 'AKIA_SHOULD_NEVER_APPEAR_IN_CSP';
    process.env.R2_SECRET_ACCESS_KEY = 'super-secret-should-never-appear-in-csp';

    const csp = await getCsp();

    expect(csp).not.toContain('AKIA_SHOULD_NEVER_APPEAR_IN_CSP');
    expect(csp).not.toContain('super-secret-should-never-appear-in-csp');
  });

  it('degrades gracefully (no "undefined" leaking into the header) when R2 env vars are absent', async () => {
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_BUCKET_NAME;

    const connectSrc = connectSrcOf(await getCsp());

    expect(connectSrc).not.toContain('undefined');
  });

  it('does not weaken other CSP directives (frame-ancestors/base-uri/form-action unchanged)', async () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_BUCKET_NAME = 'bucket';

    const csp = await getCsp();

    expect(csp).toContain(`frame-ancestors 'self'`);
    expect(csp).toContain(`base-uri 'self'`);
    expect(csp).toContain(`form-action 'self'`);
    expect(csp).toContain(`default-src 'self'`);
  });

  it('still includes the existing Supabase/Sentry/Halyk connect-src origins alongside the R2 origin', async () => {
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_BUCKET_NAME = 'bucket';

    const connectSrc = connectSrcOf(await getCsp());

    expect(connectSrc).toContain('https://*.supabase.co');
    expect(connectSrc).toContain('wss://*.supabase.co');
    expect(connectSrc).toContain('https://sentry.io');
    expect(connectSrc).toContain('https://epay-api.homebank.kz');
  });
});
