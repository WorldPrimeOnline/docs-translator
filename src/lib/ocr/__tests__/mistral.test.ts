/**
 * Proves extractTextFromPdf()'s `mistralApiKey` option bypasses @/lib/env entirely — the fix
 * for tools/pricing-cli's OCR path crashing on "Invalid option: NODE_ENV expected development |
 * test | production" when run locally via tsx (2026-07-21 investigation). @/lib/env's `env`
 * proxy validates its FULL schema on first property access; when an explicit key is passed,
 * `env.MISTRAL_API_KEY` must never be touched, so that validation must never fire — regardless
 * of NODE_ENV/R2/Anthropic/Supabase-anon being set, unset, or invalid.
 *
 * Backward compatibility: calling extractTextFromPdf(buffer) with NO options must still use
 * @/lib/env exactly as before — this module is shared with src/lib/jobs/processor.ts (a real
 * production caller), so that path must stay untouched.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

// NODE_ENV (and a few other NodeJS.ProcessEnv members) are typed readonly in this project's
// bundled types — bracket access through an untyped record sidesteps that for test setup only.
// Reads process.env fresh on every call (never caches the object reference) because afterEach
// below reassigns `process.env` wholesale between tests.
function setEnv(key: string, value: string): void {
  (process.env as Record<string, string | undefined>)[key] = value;
}
function deleteEnv(key: string): void {
  delete (process.env as Record<string, string | undefined>)[key];
}

function mockOcrResponseOnce(): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ pages: [{ markdown: 'Recognized text.' }] }),
  }) as unknown as typeof fetch;
}

function mock401Once(): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status: 401,
    text: async () => '{"detail":"Unauthorized"}',
  }) as unknown as typeof fetch;
}

describe('extractTextFromPdf — mistralApiKey dependency injection', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.resetModules();
  });

  it('works with an injected key and NODE_ENV entirely unset', async () => {
    for (const key of ['NODE_ENV', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'ANTHROPIC_API_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'MISTRAL_API_KEY']) {
      deleteEnv(key);
    }
    mockOcrResponseOnce();

    const { extractTextFromPdf } = await import('../mistral');
    const result = await extractTextFromPdf(Buffer.from('fake-pdf'), { mistralApiKey: 'injected-key' });

    expect(result.markdown).toContain('Recognized text.');
  });

  it('NEXT_PUBLIC_APP_ENV=staging + no NODE_ENV does not affect the injected-key path (they are different concepts)', async () => {
    deleteEnv('NODE_ENV');
    setEnv('NEXT_PUBLIC_APP_ENV', 'staging');
    mockOcrResponseOnce();

    const { extractTextFromPdf } = await import('../mistral');
    await expect(extractTextFromPdf(Buffer.from('fake-pdf'), { mistralApiKey: 'injected-key' })).resolves.toBeDefined();
  });

  it('sends the injected key as the Bearer token, never reading env.MISTRAL_API_KEY', async () => {
    deleteEnv('MISTRAL_API_KEY');
    mockOcrResponseOnce();

    const { extractTextFromPdf } = await import('../mistral');
    await extractTextFromPdf(Buffer.from('fake-pdf'), { mistralApiKey: 'injected-key' });

    const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
    expect(requestInit.headers.Authorization).toBe('Bearer injected-key');
  });

  it('a real (invalid) key still reaches the network call — proves the failure mode is an API error, not a config crash', async () => {
    deleteEnv('NODE_ENV');
    mock401Once();

    const { extractTextFromPdf } = await import('../mistral');
    await expect(extractTextFromPdf(Buffer.from('fake-pdf'), { mistralApiKey: 'fake-invalid-key' })).rejects.toThrow(/Mistral OCR error 401/);
  }, 15_000);

  it('omitting options keeps the original @/lib/env-backed behavior (backward compatible for src/lib/jobs/processor.ts)', async () => {
    setEnv('NODE_ENV', 'test');
    setEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    setEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
    setEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-key');
    setEnv('R2_ACCOUNT_ID', 'r2-account');
    setEnv('R2_ACCESS_KEY_ID', 'r2-key-id');
    setEnv('R2_SECRET_ACCESS_KEY', 'r2-secret');
    setEnv('R2_BUCKET_NAME', 'r2-bucket');
    setEnv('ANTHROPIC_API_KEY', 'anthropic-key');
    setEnv('MISTRAL_API_KEY', 'env-backed-key');
    mockOcrResponseOnce();

    const { extractTextFromPdf } = await import('../mistral');
    await extractTextFromPdf(Buffer.from('fake-pdf'));

    const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
    expect(requestInit.headers.Authorization).toBe('Bearer env-backed-key');
  });
});

describe('extractTextFromPdf — per-attempt timeout (2026-07-23 incident: unbounded hang)', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    jest.resetModules();
  });

  it('passes an AbortSignal to fetch so a hung provider response cannot stall indefinitely', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ pages: [{ markdown: 'ok' }] }),
    }) as unknown as typeof fetch;

    const { extractTextFromPdf } = await import('../mistral');
    await extractTextFromPdf(Buffer.from('fake-pdf'), { mistralApiKey: 'k' });

    const [, requestInit] = (global.fetch as jest.Mock).mock.calls[0];
    expect(requestInit.signal).toBeInstanceOf(AbortSignal);
  });

  it('a timeout on every attempt surfaces as a real error, not an unhandled hang', async () => {
    global.fetch = jest.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const abort = () => {
          const err = new Error('The operation was aborted');
          err.name = 'TimeoutError';
          reject(err);
        };
        if (init.signal?.aborted) abort();
        else init.signal?.addEventListener('abort', abort);
      });
    }) as unknown as typeof fetch;

    // Simulate an already-timed-out signal so the test doesn't need to wait 90s in real time.
    const originalTimeout = AbortSignal.timeout;
    AbortSignal.timeout = jest.fn().mockImplementation(() => {
      const controller = new AbortController();
      controller.abort();
      return controller.signal;
    }) as unknown as typeof AbortSignal.timeout;

    try {
      const { extractTextFromPdf } = await import('../mistral');
      await expect(extractTextFromPdf(Buffer.from('fake-pdf'), { mistralApiKey: 'k' })).rejects.toThrow(/timed out/i);
    } finally {
      AbortSignal.timeout = originalTimeout;
    }
  }, 15_000);
});

describe('worker OCR is untouched (separate module, own env)', () => {
  it('worker/src/lib/ocr.ts does not reference mistralApiKey / ExtractTextFromPdfOptions — it keeps its own independent implementation', () => {
    const workerOcrPath = path.join(__dirname, '..', '..', '..', '..', 'worker', 'src', 'lib', 'ocr.ts');
    const content = fs.readFileSync(workerOcrPath, 'utf-8');
    expect(content).not.toContain('mistralApiKey');
    expect(content).not.toContain('ExtractTextFromPdfOptions');
  });
});
