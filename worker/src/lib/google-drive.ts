// Google Drive integration for the Railway worker.
//
// Two auth modes — selected by GOOGLE_AUTH_MODE env var:
//   service_account (preferred): GOOGLE_AUTH_MODE=service_account
//     + GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 (base64-encoded service account key JSON)
//     + GOOGLE_DRIVE_ROOT_FOLDER_ID
//
//   oauth (legacy fallback): GOOGLE_AUTH_MODE unset or anything else
//     + GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET + GOOGLE_REFRESH_TOKEN
//     + GOOGLE_DRIVE_ROOT_FOLDER_ID
//
// JWT signing for service account uses Node.js built-in crypto — no googleapis package needed.

import * as crypto from 'crypto';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServiceAccountJson {
  type: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  token_uri?: string;
}

export interface DriveFolder {
  folderId: string;
  folderUrl: string;
  subfolders: {
    source: string;
    aiDraft: string;
    translatorResult: string;
    signatureStamp: string;
    notary: string;
    final: string;
  };
}

export const DRIVE_SUBFOLDER_NAMES = {
  source: '01_SOURCE',
  aiDraft: '02_AI_DRAFT',
  translatorResult: '03_TRANSLATOR_RESULT',
  signatureStamp: '04_SIGNATURE_AND_STAMP',
  notary: '05_NOTARY',
  final: '06_FINAL',
} as const;

// ─── Auth mode ────────────────────────────────────────────────────────────────

export function getAuthMode(): 'service_account' | 'oauth' {
  return process.env.GOOGLE_AUTH_MODE === 'service_account' ? 'service_account' : 'oauth';
}

export function isDriveConfigured(): boolean {
  const mode = getAuthMode();
  const hasRoot = !!process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (mode === 'service_account') {
    return hasRoot && !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  }
  return (
    hasRoot &&
    !!process.env.GOOGLE_CLIENT_ID &&
    !!process.env.GOOGLE_CLIENT_SECRET &&
    !!process.env.GOOGLE_REFRESH_TOKEN
  );
}

export function logDriveAuthMode(): void {
  const mode = getAuthMode();
  const root = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? '(not set)';
  const configured = isDriveConfigured();
  console.log(`[drive] auth mode: ${mode} | root folder: ${root} | configured: ${configured}`);
}

// ─── Token cache ──────────────────────────────────────────────────────────────

type TokenCache = { token: string; expiresAt: number };
let _cachedToken: TokenCache | null = null;

export function _resetTokenCache(): void {
  _cachedToken = null;
}

// ─── Service account JWT ──────────────────────────────────────────────────────

function parseServiceAccountJson(): ServiceAccountJson {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not set');

  let jsonStr: string;
  try {
    jsonStr = Buffer.from(b64, 'base64').toString('utf-8');
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not valid base64');
  }

  let parsed: ServiceAccountJson;
  try {
    parsed = JSON.parse(jsonStr) as ServiceAccountJson;
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 decoded to invalid JSON');
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('Service account JSON missing required fields (client_email, private_key)');
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
  const signature = sign.sign(sa.private_key).toString('base64url');
  return `${unsigned}.${signature}`;
}

async function fetchServiceAccountToken(): Promise<{ token: string; expiresIn: number }> {
  const sa = parseServiceAccountJson();
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
    throw new Error(
      `Service account token fetch failed: ${res.status} — ${text.slice(0, 200)}`,
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { token: data.access_token, expiresIn: data.expires_in };
}

async function fetchOAuthToken(): Promise<{ token: string; expiresIn: number }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google OAuth credentials not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN)',
    );
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    throw new Error(`Google OAuth token refresh failed: ${res.status}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  return { token: data.access_token, expiresIn: data.expires_in };
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (_cachedToken && _cachedToken.expiresAt > now + 60_000) return _cachedToken.token;

  const { token, expiresIn } =
    getAuthMode() === 'service_account'
      ? await fetchServiceAccountToken()
      : await fetchOAuthToken();

  _cachedToken = { token, expiresAt: now + expiresIn * 1000 };
  return token;
}

// ─── Drive API helpers ────────────────────────────────────────────────────────

async function driveGet(path: string): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`https://www.googleapis.com/drive/v3${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
}

async function drivePost(path: string, body: unknown): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`https://www.googleapis.com/drive/v3${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function findExistingFolder(name: string, parentId: string): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const res = await driveGet(`/files?q=${q}&fields=files(id)&pageSize=1`);
  if (!res.ok) return null;
  const data = (await res.json()) as { files: { id: string }[] };
  return data.files[0]?.id ?? null;
}

async function createFolder(name: string, parentId: string): Promise<string> {
  const res = await drivePost('/files', {
    name,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentId],
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Drive createFolder "${name}" failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function getOrCreateFolder(name: string, parentId: string): Promise<string> {
  const existing = await findExistingFolder(name, parentId);
  if (existing) return existing;
  return createFolder(name, parentId);
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function createOrderFolder(jobId: string): Promise<DriveFolder> {
  if (!isDriveConfigured()) throw new Error('Google Drive not configured');

  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;
  const folderName = `WPO-${jobId.slice(0, 8)}`;

  const mainId = await getOrCreateFolder(folderName, rootFolderId);

  const [source, aiDraft, translatorResult, signatureStamp, notary, final] = await Promise.all([
    getOrCreateFolder(DRIVE_SUBFOLDER_NAMES.source, mainId),
    getOrCreateFolder(DRIVE_SUBFOLDER_NAMES.aiDraft, mainId),
    getOrCreateFolder(DRIVE_SUBFOLDER_NAMES.translatorResult, mainId),
    getOrCreateFolder(DRIVE_SUBFOLDER_NAMES.signatureStamp, mainId),
    getOrCreateFolder(DRIVE_SUBFOLDER_NAMES.notary, mainId),
    getOrCreateFolder(DRIVE_SUBFOLDER_NAMES.final, mainId),
  ]);

  return {
    folderId: mainId,
    folderUrl: `https://drive.google.com/drive/folders/${mainId}`,
    subfolders: { source, aiDraft, translatorResult, signatureStamp, notary, final },
  };
}

export async function uploadFileToDrive(
  folderId: string,
  filename: string,
  buffer: Buffer,
  mimeType: string,
): Promise<string> {
  const token = await getAccessToken();
  const boundary = `wpo_boundary_${Date.now()}`;
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });

  const bodyBuf = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`, 'utf-8'),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, 'utf-8'),
    buffer,
    Buffer.from(`\r\n--${boundary}--`, 'utf-8'),
  ]);

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: bodyBuf,
    },
  );

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Drive upload "${filename}" failed: ${res.status} ${t.slice(0, 200)}`);
  }

  const data = (await res.json()) as { id: string };
  return data.id;
}

export async function getSubfolderId(parentFolderId: string, subfolderName: string): Promise<string | null> {
  return findExistingFolder(subfolderName, parentFolderId);
}
