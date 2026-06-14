// Google Drive integration using service account credentials.
// Root folder is pre-shared with operator/translator/notary — no per-subfolder permissions set here.
// Required env vars: GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON, GOOGLE_DRIVE_ROOT_FOLDER_ID

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

type AccessToken = { token: string; expiresAt: number };

let _cachedToken: AccessToken | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (_cachedToken && _cachedToken.expiresAt > now + 60_000) {
    return _cachedToken.token;
  }

  const credJson = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (!credJson) throw new Error('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON not set');

  const creds = JSON.parse(credJson) as {
    client_email: string;
    private_key: string;
  };

  // Build JWT for service account
  const header = { alg: 'RS256', typ: 'JWT' };
  const iat = Math.floor(now / 1000);
  const payload = {
    iss: creds.client_email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: iat + 3600,
    iat,
  };

  const encode = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');

  const unsigned = `${encode(header)}.${encode(payload)}`;

  // Import private key and sign
  const keyData = creds.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const keyBuffer = Buffer.from(keyData, 'base64');
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    Buffer.from(unsigned),
  );

  const jwt = `${unsigned}.${Buffer.from(signature).toString('base64url')}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth2:grant_type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    const t = await tokenRes.text().catch(() => '');
    throw new Error(`Google OAuth token failed: ${tokenRes.status} ${t.slice(0, 200)}`);
  }

  const { access_token, expires_in } = (await tokenRes.json()) as {
    access_token: string;
    expires_in: number;
  };

  _cachedToken = { token: access_token, expires_at: now + expires_in * 1000 } as unknown as AccessToken;
  _cachedToken = { token: access_token, expiresAt: now + expires_in * 1000 };
  return access_token;
}

async function driveApiFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
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
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId || !process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON) {
    console.log('[drive] Google Drive not configured — skipping folder creation');
    return null;
  }

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

  // Multipart upload
  const boundary = `boundary_${Date.now()}`;
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    '',
    '',
  ].join('\r\n');

  const bodyBuf = Buffer.concat([
    Buffer.from(body, 'utf-8'),
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
        'Content-Length': String(bodyBuf.length),
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
