/**
 * @jest-environment node
 *
 * Runtime tests for the Drive OAuth token-refresh health check (WO-75 incident follow-up).
 * Mocks global.fetch — no real network calls.
 */

const ORIGINAL_FETCH = global.fetch;

function mockFetchOnce(status: number, body: unknown): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  }) as unknown as typeof fetch;
}

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  delete process.env.GOOGLE_AUTH_MODE;
  delete process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REFRESH_TOKEN;
  jest.resetModules();
});

describe('checkDriveTokenHealth', () => {
  it('reports not configured without making a network call', async () => {
    const { checkDriveTokenHealth } = await import('../google-drive');
    global.fetch = jest.fn();
    const result = await checkDriveTokenHealth();
    expect(result.configured).toBe(false);
    expect(result.tokenRefreshOk).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reports ok when the OAuth token refresh succeeds', async () => {
    process.env.GOOGLE_CLIENT_ID = 'cid';
    process.env.GOOGLE_CLIENT_SECRET = 'csecret';
    process.env.GOOGLE_REFRESH_TOKEN = 'rtoken';
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'folder-id';
    mockFetchOnce(200, { access_token: 'fake-token', expires_in: 3600 });

    const { checkDriveTokenHealth } = await import('../google-drive');
    const result = await checkDriveTokenHealth();
    expect(result.tokenRefreshOk).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('surfaces invalid_grant with an actionable hint on a 400', async () => {
    process.env.GOOGLE_CLIENT_ID = 'cid';
    process.env.GOOGLE_CLIENT_SECRET = 'csecret';
    process.env.GOOGLE_REFRESH_TOKEN = 'rtoken';
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'folder-id';
    mockFetchOnce(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });

    const { checkDriveTokenHealth } = await import('../google-drive');
    const result = await checkDriveTokenHealth();
    expect(result.tokenRefreshOk).toBe(false);
    expect(result.error).toContain('invalid_grant');
    expect(result.error).toContain('expired/revoked');
  });

  it('surfaces invalid_client with an actionable hint on a 400', async () => {
    process.env.GOOGLE_CLIENT_ID = 'cid';
    process.env.GOOGLE_CLIENT_SECRET = 'csecret';
    process.env.GOOGLE_REFRESH_TOKEN = 'rtoken';
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'folder-id';
    mockFetchOnce(400, { error: 'invalid_client', error_description: 'The OAuth client was not found.' });

    const { checkDriveTokenHealth } = await import('../google-drive');
    const result = await checkDriveTokenHealth();
    expect(result.tokenRefreshOk).toBe(false);
    expect(result.error).toContain('invalid_client');
    expect(result.error).toContain('do not match');
  });

  it('never includes the refresh token or client secret in the error result', async () => {
    process.env.GOOGLE_CLIENT_ID = 'cid';
    process.env.GOOGLE_CLIENT_SECRET = 'super-secret-value';
    process.env.GOOGLE_REFRESH_TOKEN = 'super-secret-refresh-token';
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'folder-id';
    mockFetchOnce(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });

    const { checkDriveTokenHealth } = await import('../google-drive');
    const result = await checkDriveTokenHealth();
    expect(JSON.stringify(result)).not.toContain('super-secret-value');
    expect(JSON.stringify(result)).not.toContain('super-secret-refresh-token');
  });
});
