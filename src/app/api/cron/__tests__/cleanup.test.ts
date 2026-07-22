/**
 * Tests for GET /api/cron/cleanup — focused on the raw-upload sweep
 * (cleanupOrphanedRawUploads) added for the direct-to-R2 draft upload flow.
 * The pre-existing document/order_draft cleanup behavior is left untouched and is
 * only stubbed here (empty result sets) so it doesn't interfere with these assertions.
 */
jest.mock('@/lib/supabase/server', () => ({
  supabaseServer: { from: jest.fn() },
}));
jest.mock('@/lib/r2/client', () => ({
  deleteFile: jest.fn(),
  listObjectsByPrefix: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { GET } from '../cleanup/route';
import { supabaseServer } from '@/lib/supabase/server';
import { deleteFile, listObjectsByPrefix } from '@/lib/r2/client';

const mockFrom = supabaseServer.from as jest.Mock;
const mockDeleteFile = deleteFile as jest.Mock;
const mockListObjectsByPrefix = listObjectsByPrefix as jest.Mock;

function chain(result: { data?: unknown; error?: unknown }) {
  const c: Record<string, unknown> = {};
  const methods = ['select', 'eq', 'neq', 'gte', 'lt', 'in', 'limit'];
  for (const m of methods) c[m] = jest.fn(() => c);
  c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return c;
}

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/cron/cleanup', {
    headers: { authorization: 'Bearer test-secret' },
  });
}

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  jest.resetAllMocks();
  process.env.CRON_SECRET = 'test-secret';
  // No stale `documents` rows and no expired `order_drafts` rows — isolates the
  // assertions below to the new raw-upload sweep.
  mockFrom.mockReturnValue(chain({ data: [], error: null }));
});

it('rejects requests without the correct CRON_SECRET bearer token', async () => {
  const req = new NextRequest('http://localhost/api/cron/cleanup', { headers: { authorization: 'Bearer wrong' } });
  const res = await GET(req);
  expect(res.status).toBe(401);
  expect(mockListObjectsByPrefix).not.toHaveBeenCalled();
});

it('lists the draft-upload-raw/ prefix only (never draft-uploads/ or documents/)', async () => {
  mockListObjectsByPrefix.mockResolvedValueOnce([]); // draft-upload-raw/ call
  await GET(makeRequest());
  expect(mockListObjectsByPrefix).toHaveBeenCalledWith('draft-upload-raw/');
  expect(mockListObjectsByPrefix).not.toHaveBeenCalledWith('draft-uploads/');
  expect(mockListObjectsByPrefix).not.toHaveBeenCalledWith(expect.stringMatching(/^documents\//));
  expect(mockListObjectsByPrefix).toHaveBeenCalledTimes(1);
});

it('deletes raw uploads older than 24 hours', async () => {
  mockListObjectsByPrefix.mockResolvedValueOnce([
    { key: 'draft-upload-raw/draft-1/uuid-old', lastModified: new Date(NOW - 25 * HOUR) },
  ]);
  mockDeleteFile.mockResolvedValueOnce(undefined);

  const res = await GET(makeRequest());
  const body = await res.json() as { rawUploadsDeleted: number };

  expect(mockDeleteFile).toHaveBeenCalledWith('draft-upload-raw/draft-1/uuid-old');
  expect(body.rawUploadsDeleted).toBe(1);
});

it('does not delete raw uploads younger than 24 hours', async () => {
  mockListObjectsByPrefix.mockResolvedValueOnce([
    { key: 'draft-upload-raw/draft-1/uuid-fresh', lastModified: new Date(NOW - 1 * HOUR) },
  ]);

  const res = await GET(makeRequest());
  const body = await res.json() as { rawUploadsDeleted: number };

  expect(mockDeleteFile).not.toHaveBeenCalled();
  expect(body.rawUploadsDeleted).toBe(0);
});

it('never touches the final draft PDF or a real document, since the list call is scoped to the raw prefix only', async () => {
  // Even if listObjectsByPrefix somehow returned something outside the raw prefix
  // (it shouldn't, given the Prefix passed above), the sweep only ever calls
  // deleteFile with whatever listObjectsByPrefix('draft-upload-raw/') returned —
  // the assertion above on the exact prefix argument is what actually enforces this.
  mockListObjectsByPrefix.mockResolvedValueOnce([
    { key: 'draft-upload-raw/draft-1/uuid-old', lastModified: new Date(NOW - 48 * HOUR) },
  ]);
  await GET(makeRequest());

  expect(mockDeleteFile).not.toHaveBeenCalledWith('draft-uploads/draft-1/original.pdf');
  expect(mockDeleteFile).not.toHaveBeenCalledWith(expect.stringMatching(/^documents\//));
});

it('continues past a failed delete and still deletes the rest (one bad object does not stop the sweep)', async () => {
  mockListObjectsByPrefix.mockResolvedValueOnce([
    { key: 'draft-upload-raw/draft-1/uuid-a', lastModified: new Date(NOW - 30 * HOUR) },
    { key: 'draft-upload-raw/draft-2/uuid-b', lastModified: new Date(NOW - 30 * HOUR) },
  ]);
  mockDeleteFile
    .mockRejectedValueOnce(new Error('R2 transient error'))
    .mockResolvedValueOnce(undefined);

  const res = await GET(makeRequest());
  const body = await res.json() as { rawUploadsDeleted: number };

  expect(mockDeleteFile).toHaveBeenCalledTimes(2);
  expect(body.rawUploadsDeleted).toBe(1); // only the successful delete is counted
});

it('does not fail the whole cron run when listObjectsByPrefix itself errors', async () => {
  mockListObjectsByPrefix.mockRejectedValueOnce(new Error('R2 unavailable'));
  const res = await GET(makeRequest());
  const body = await res.json() as { rawUploadsDeleted: number };
  expect(res.status).toBe(200);
  expect(body.rawUploadsDeleted).toBe(0);
});
