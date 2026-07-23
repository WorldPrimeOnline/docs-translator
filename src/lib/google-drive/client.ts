// Google Drive integration via OAuth2 refresh-token flow.
// Required env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
//                    GOOGLE_DRIVE_ROOT_FOLDER_ID
//
// Root folder is pre-shared with operator/translator/notary — no per-subfolder permissions set here.
// Access token is cached in memory; refresh token is never logged.

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

type AccessTokenCache = { token: string; expiresAt: number };

let _cachedToken: AccessTokenCache | null = null;

function isDriveConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN &&
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
  );
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (_cachedToken && _cachedToken.expiresAt > now + 60_000) {
    return _cachedToken.token;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Google OAuth credentials not configured (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN)');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    throw new Error(`Google OAuth token refresh failed: ${res.status} — check credentials`);
  }

  const { access_token, expires_in } = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  _cachedToken = { token: access_token, expiresAt: now + expires_in * 1000 };
  return access_token;
}

async function driveApiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  return fetch(`https://www.googleapis.com/drive/v3${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> ?? {}),
    },
  });
}

async function createFolder(name: string, parentId: string): Promise<string> {
  const res = await driveApiFetch('/files', {
    method: 'POST',
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Drive createFolder "${name}" failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { id: string };
  return data.id;
}

async function findExistingFolder(name: string, parentId: string): Promise<string | null> {
  const q = encodeURIComponent(
    `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
  );
  const res = await driveApiFetch(`/files?q=${q}&fields=files(id,name)&pageSize=1`);
  if (!res.ok) return null;
  const data = (await res.json()) as { files: { id: string }[] };
  return data.files[0]?.id ?? null;
}

async function getOrCreateFolder(name: string, parentId: string): Promise<string> {
  const existing = await findExistingFolder(name, parentId);
  if (existing) return existing;
  return createFolder(name, parentId);
}

export async function createOrderFolder(jobId: string): Promise<DriveFolder | null> {
  if (!isDriveConfigured()) {
    console.log('[drive] Google Drive not configured — skipping folder creation');
    return null;
  }

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
  if (!isDriveConfigured()) return '';

  const token = await getAccessToken();
  const boundary = `wpo_boundary_${Date.now()}`;
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });

  const bodyParts = [
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  ];

  const bodyBuf = Buffer.concat([
    Buffer.from(bodyParts.join(''), 'utf-8'),
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

/** Check if Drive is configured (does not verify credentials). */
export function isDriveEnabled(): boolean {
  return isDriveConfigured();
}

/**
 * 2026-07-24 retention fix: trashes the order's Drive folder (moves to Drive Trash,
 * NOT a permanent delete — Drive keeps trashed items for its own separate retention
 * window, an extra safety net against a bug here) as part of the 30-day retention
 * cleanup. Trashing the top-level order folder cascades to every subfolder/file inside
 * it in a single call — never enumerates and deletes individual files. Returns false
 * (never throws) when Drive isn't configured or the request fails — retention cleanup
 * treats this as a best-effort, independently-retryable step, never blocking or
 * blocked by the R2/DB purge (see documents.drive_purged_at).
 */
export async function trashOrderFolder(folderId: string): Promise<boolean> {
  if (!isDriveConfigured()) return false;
  try {
    const res = await driveApiFetch(`/files/${encodeURIComponent(folderId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ trashed: true }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
