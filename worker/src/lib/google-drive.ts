// Google Drive integration for the Railway worker.
// Required env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN,
//                    GOOGLE_DRIVE_ROOT_FOLDER_ID

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

export function isDriveConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN &&
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
  );
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (_cachedToken && _cachedToken.expiresAt > now + 60_000) return _cachedToken.token;

  const clientId = process.env.GOOGLE_CLIENT_ID!;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN!;

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

  const { access_token, expires_in } = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };

  _cachedToken = { token: access_token, expiresAt: now + expires_in * 1000 };
  return access_token;
}

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

/** Find the subfolder ID by name under the given parent (for uploading to specific stage). */
export async function getSubfolderId(parentFolderId: string, subfolderName: string): Promise<string | null> {
  return findExistingFolder(subfolderName, parentFolderId);
}
