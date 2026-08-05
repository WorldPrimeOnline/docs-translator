/**
 * @jest-environment node
 */

// Minimal unit tests for Google Drive OAuth client.
// Full integration requires real credentials — tested on staging.

const FAKE_TOKEN = 'ya29.fake_access_token';
const FOLDER_ID = 'folder123';
const SUBFOLDER_ID = 'sub456';

function makeTokenResponse() {
  return { ok: true, json: async () => ({ access_token: FAKE_TOKEN, expires_in: 3600 }) };
}

function makeFolderResponse(id: string) {
  return { ok: true, json: async () => ({ id }) };
}

function makeSearchResponse(files: { id: string }[]) {
  return { ok: true, json: async () => ({ files }) };
}

beforeEach(() => {
  process.env.GOOGLE_CLIENT_ID = 'test_client_id';
  process.env.GOOGLE_CLIENT_SECRET = 'test_client_secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'test_refresh_token';
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'root123';
  global.fetch = jest.fn();
  jest.resetModules();
});

afterEach(() => {
  jest.resetAllMocks();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REFRESH_TOKEN;
  delete process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
});

describe('isDriveEnabled', () => {
  it('returns true when all env vars are set', async () => {
    const { isDriveEnabled } = await import('../client');
    expect(isDriveEnabled()).toBe(true);
  });

  it('returns false when any env var is missing', async () => {
    delete process.env.GOOGLE_REFRESH_TOKEN;
    const { isDriveEnabled } = await import('../client');
    expect(isDriveEnabled()).toBe(false);
  });
});

describe('createOrderFolder — idempotency', () => {
  it('reuses existing folder when found in Drive', async () => {
    const fetchMock = global.fetch as jest.Mock;

    // 1. Token request
    fetchMock.mockResolvedValueOnce(makeTokenResponse());
    // 2. Search for main folder → found
    fetchMock.mockResolvedValueOnce(makeSearchResponse([{ id: FOLDER_ID }]));
    // 3-8. Search for each of 6 subfolders → found
    for (let i = 0; i < 6; i++) {
      fetchMock.mockResolvedValueOnce(makeSearchResponse([{ id: SUBFOLDER_ID }]));
    }

    const { createOrderFolder } = await import('../client');
    const result = await createOrderFolder('aaaabbbbccccdddd');

    expect(result).not.toBeNull();
    expect(result!.folderId).toBe(FOLDER_ID);
    // Should NOT have called POST /files (create) — only GET searches
    const postCalls = fetchMock.mock.calls.filter(([url, opts]: [string, RequestInit]) =>
      String(url).includes('/files') && opts?.method === 'POST',
    );
    expect(postCalls).toHaveLength(0);
  });

  it('creates new folder when not found', async () => {
    const fetchMock = global.fetch as jest.Mock;

    // 1. Token
    fetchMock.mockResolvedValueOnce(makeTokenResponse());
    // 2. Search main → not found
    fetchMock.mockResolvedValueOnce(makeSearchResponse([]));
    // 3. Create main
    fetchMock.mockResolvedValueOnce(makeFolderResponse(FOLDER_ID));
    // 4-9. Search all 6 subfolders → not found (Promise.all sends all searches before any create)
    for (let i = 0; i < 6; i++) {
      fetchMock.mockResolvedValueOnce(makeSearchResponse([]));
    }
    // 10-15. Create all 6 subfolders
    for (let i = 0; i < 6; i++) {
      fetchMock.mockResolvedValueOnce(makeFolderResponse(SUBFOLDER_ID));
    }

    const { createOrderFolder } = await import('../client');
    const result = await createOrderFolder('aaaabbbbccccdddd');

    expect(result).not.toBeNull();
    expect(result!.folderId).toBe(FOLDER_ID);
    expect(result!.subfolders.source).toBe(SUBFOLDER_ID);
  });

  it('returns null when Drive is not configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const { createOrderFolder } = await import('../client');
    const result = await createOrderFolder('aaaabbbbccccdddd');
    expect(result).toBeNull();
  });
});

describe('trashOrderFolder (2026-07-24 retention cleanup)', () => {
  it('PATCHes the folder with trashed:true and returns true on success', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce(makeTokenResponse());
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: FOLDER_ID, trashed: true }) });

    const { trashOrderFolder } = await import('../client');
    const result = await trashOrderFolder(FOLDER_ID);

    expect(result).toBe(true);
    const [url, opts] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(String(url)).toContain(`/files/${FOLDER_ID}`);
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body as string)).toEqual({ trashed: true });
  });

  it('never enumerates individual files — exactly one PATCH call to the folder itself, regardless of what it contains', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce(makeTokenResponse());
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ id: FOLDER_ID }) });

    const { trashOrderFolder } = await import('../client');
    await trashOrderFolder(FOLDER_ID);

    // Token request + exactly one folder PATCH — no /files list/search call.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns false (never throws) on an API error response', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockResolvedValueOnce(makeTokenResponse());
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'Not Found' });

    const { trashOrderFolder } = await import('../client');
    await expect(trashOrderFolder(FOLDER_ID)).resolves.toBe(false);
  });

  it('returns false (never throws) on a network failure', async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const { trashOrderFolder } = await import('../client');
    await expect(trashOrderFolder(FOLDER_ID)).resolves.toBe(false);
  });

  it('returns false without any network call when Drive is not configured', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    const fetchMock = global.fetch as jest.Mock;

    const { trashOrderFolder } = await import('../client');
    const result = await trashOrderFolder(FOLDER_ID);

    expect(result).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
