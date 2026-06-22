/**
 * Smoke-test for Google Drive authentication (service account or legacy OAuth).
 * Loads env from .env.local, connects to Drive, creates a test folder, then deletes it.
 *
 * Usage (run from repo root):
 *   npx tsx scripts/test-google-drive-auth.ts
 *
 * Reads the same env vars as the Railway worker:
 *   GOOGLE_AUTH_MODE                    — 'service_account' | anything else (legacy OAuth)
 *   GOOGLE_SERVICE_ACCOUNT_JSON_BASE64  — required in service_account mode
 *   GOOGLE_DRIVE_ROOT_FOLDER_ID         — required in both modes
 *   GOOGLE_CLIENT_ID                    — required in legacy OAuth mode
 *   GOOGLE_CLIENT_SECRET                — required in legacy OAuth mode
 *   GOOGLE_REFRESH_TOKEN                — required in legacy OAuth mode
 */

import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

// ─── Auth ─────────────────────────────────────────────────────────────────────

interface ServiceAccountJson {
  private_key: string;
  client_email: string;
  token_uri?: string;
}

function getAuthMode(): 'service_account' | 'oauth' {
  return process.env.GOOGLE_AUTH_MODE === 'service_account' ? 'service_account' : 'oauth';
}

function parseServiceAccount(): ServiceAccountJson {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not set');
  const json = Buffer.from(b64, 'base64').toString('utf-8');
  const parsed = JSON.parse(json) as ServiceAccountJson;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Service account JSON missing client_email or private_key');
  }
  return parsed;
}

function buildJwt(sa: ServiceAccountJson): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/drive',
      aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  ).toString('base64url');
  const unsigned = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsigned);
  return `${unsigned}.${sign.sign(sa.private_key).toString('base64url')}`;
}

async function getAccessToken(): Promise<string> {
  const mode = getAuthMode();
  console.log(`  auth mode: ${mode}`);

  if (mode === 'service_account') {
    const sa = parseServiceAccount();
    console.log(`  service account: ${sa.client_email}`);
    const jwt = buildJwt(sa);
    const tokenUrl = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Service account token fetch failed: ${res.status} — ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as { access_token: string };
    return data.access_token;
  }

  // Legacy OAuth
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error('Legacy OAuth requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: GOOGLE_REFRESH_TOKEN,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth token refresh failed: ${res.status}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

// ─── Drive helpers ────────────────────────────────────────────────────────────

async function driveGet(token: string, path: string): Promise<Response> {
  return fetch(`https://www.googleapis.com/drive/v3${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
}

async function drivePost(token: string, path: string, body: unknown): Promise<Response> {
  return fetch(`https://www.googleapis.com/drive/v3${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n=== Google Drive auth smoke test ===\n');

  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) {
    console.error('ERROR: GOOGLE_DRIVE_ROOT_FOLDER_ID is not set');
    process.exit(1);
  }
  console.log(`  root folder: ${rootFolderId}`);

  // ── 1. Get access token ─────────────────────────────────────────────────────
  let token: string;
  try {
    token = await getAccessToken();
    console.log('  ✓ access token obtained');
  } catch (err) {
    console.error(`\nFAIL — could not get access token: ${(err as Error).message}`);
    process.exit(1);
  }

  // ── 2. Verify root folder is accessible ──────────────────────────────────────
  const folderRes = await driveGet(token, `/files/${rootFolderId}?fields=id,name`);
  if (!folderRes.ok) {
    const text = await folderRes.text().catch(() => '');
    console.error(`\nFAIL — root folder not accessible (${folderRes.status}): ${text.slice(0, 300)}`);
    console.error('  → Make sure the service account has been granted access to the root folder.');
    process.exit(1);
  }
  const folderMeta = (await folderRes.json()) as { id: string; name: string };
  console.log(`  ✓ root folder accessible: "${folderMeta.name}" (${folderMeta.id})`);

  // ── 3. Create test folder ─────────────────────────────────────────────────────
  const testFolderName = `WPO_AUTH_TEST_${Date.now()}`;
  const createRes = await drivePost(token, '/files', {
    name: testFolderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [rootFolderId],
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => '');
    console.error(`\nFAIL — could not create test folder (${createRes.status}): ${text.slice(0, 300)}`);
    process.exit(1);
  }
  const created = (await createRes.json()) as { id: string };
  console.log(`  ✓ test folder created: "${testFolderName}" (${created.id})`);

  // ── 4. Delete test folder ─────────────────────────────────────────────────────
  const deleteRes = await fetch(`https://www.googleapis.com/drive/v3/files/${created.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!deleteRes.ok && deleteRes.status !== 204) {
    console.warn(`  ⚠ test folder cleanup failed (${deleteRes.status}) — delete it manually: ${created.id}`);
  } else {
    console.log(`  ✓ test folder deleted`);
  }

  console.log('\n=== SUCCESS — Drive auth is working correctly ===\n');
}

main().catch((err) => {
  console.error('\nUnexpected error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
