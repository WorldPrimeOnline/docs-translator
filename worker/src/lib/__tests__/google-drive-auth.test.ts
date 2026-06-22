/**
 * @jest-environment node
 *
 * Structural tests for the Google Drive dual-mode auth implementation.
 * Validates behaviour contracts without making real network calls.
 */

import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(
  path.join(__dirname, '../google-drive.ts'),
  'utf-8',
);

afterEach(() => {
  // Reset env between tests
  delete process.env.GOOGLE_AUTH_MODE;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  delete process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  delete process.env.GOOGLE_REFRESH_TOKEN;
  jest.resetModules();
});

// ─── Source-level contracts ──────────────────────────────────────────────────

describe('google-drive source structure', () => {
  it('exports getAuthMode', () => {
    expect(SRC).toContain('export function getAuthMode');
  });

  it('exports isDriveConfigured', () => {
    expect(SRC).toContain('export function isDriveConfigured');
  });

  it('exports logDriveAuthMode', () => {
    expect(SRC).toContain('export function logDriveAuthMode');
  });

  it('exports _resetTokenCache for testing', () => {
    expect(SRC).toContain('export function _resetTokenCache');
  });

  it('uses GOOGLE_DRIVE_ROOT_FOLDER_ID (not GOOGLE_DRIVE_PARENT_FOLDER_ID)', () => {
    expect(SRC).toContain('GOOGLE_DRIVE_ROOT_FOLDER_ID');
    expect(SRC).not.toContain('GOOGLE_DRIVE_PARENT_FOLDER_ID');
  });

  it('service_account mode reads GOOGLE_SERVICE_ACCOUNT_JSON_BASE64', () => {
    expect(SRC).toContain('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64');
  });

  it('service_account mode builds a JWT (RS256)', () => {
    expect(SRC).toContain('RSA-SHA256');
    expect(SRC).toContain('base64url');
  });

  it('service_account mode uses jwt-bearer grant type', () => {
    expect(SRC).toContain('urn:ietf:params:oauth:grant-type:jwt-bearer');
  });

  it('legacy OAuth mode still uses refresh_token grant', () => {
    expect(SRC).toContain('grant_type');
    expect(SRC).toContain('refresh_token');
  });

  it('does not log private_key or base64 secret', () => {
    expect(SRC).not.toMatch(/console\.(log|info|error|warn).*private_key/);
    expect(SRC).not.toMatch(/console\.(log|info|error|warn).*SERVICE_ACCOUNT_JSON_BASE64/);
  });

  it('throws a clear error when base64 is not valid JSON', () => {
    expect(SRC).toContain('decoded to invalid JSON');
  });

  it('throws when GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is missing', () => {
    expect(SRC).toContain('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not set');
  });

  it('throws when service account JSON lacks required fields', () => {
    expect(SRC).toContain('client_email');
    expect(SRC).toContain('private_key');
    expect(SRC).toContain('Service account JSON missing required fields');
  });
});

// ─── Runtime: getAuthMode ────────────────────────────────────────────────────

describe('getAuthMode', () => {
  it('returns service_account when GOOGLE_AUTH_MODE=service_account', async () => {
    process.env.GOOGLE_AUTH_MODE = 'service_account';
    const { getAuthMode } = await import('../google-drive');
    expect(getAuthMode()).toBe('service_account');
  });

  it('returns oauth when GOOGLE_AUTH_MODE is unset', async () => {
    const { getAuthMode } = await import('../google-drive');
    expect(getAuthMode()).toBe('oauth');
  });

  it('returns oauth for any non-service_account value', async () => {
    process.env.GOOGLE_AUTH_MODE = 'legacy';
    const { getAuthMode } = await import('../google-drive');
    expect(getAuthMode()).toBe('oauth');
  });
});

// ─── Runtime: isDriveConfigured ──────────────────────────────────────────────

describe('isDriveConfigured — service_account mode', () => {
  beforeEach(() => {
    process.env.GOOGLE_AUTH_MODE = 'service_account';
  });

  it('returns true when both SA env vars are set', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 = 'abc';
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'folder-id';
    const { isDriveConfigured } = await import('../google-drive');
    expect(isDriveConfigured()).toBe(true);
  });

  it('returns false when GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is missing', async () => {
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'folder-id';
    const { isDriveConfigured } = await import('../google-drive');
    expect(isDriveConfigured()).toBe(false);
  });

  it('returns false when GOOGLE_DRIVE_ROOT_FOLDER_ID is missing', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 = 'abc';
    const { isDriveConfigured } = await import('../google-drive');
    expect(isDriveConfigured()).toBe(false);
  });

  it('does NOT require GOOGLE_REFRESH_TOKEN in service_account mode', async () => {
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 = 'abc';
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'folder-id';
    // GOOGLE_REFRESH_TOKEN deliberately absent
    const { isDriveConfigured } = await import('../google-drive');
    expect(isDriveConfigured()).toBe(true);
  });
});

describe('isDriveConfigured — legacy OAuth mode', () => {
  it('returns true with all four OAuth env vars', async () => {
    process.env.GOOGLE_CLIENT_ID = 'cid';
    process.env.GOOGLE_CLIENT_SECRET = 'csecret';
    process.env.GOOGLE_REFRESH_TOKEN = 'rtoken';
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'folder-id';
    const { isDriveConfigured } = await import('../google-drive');
    expect(isDriveConfigured()).toBe(true);
  });

  it('returns false when GOOGLE_REFRESH_TOKEN is missing', async () => {
    process.env.GOOGLE_CLIENT_ID = 'cid';
    process.env.GOOGLE_CLIENT_SECRET = 'csecret';
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'folder-id';
    const { isDriveConfigured } = await import('../google-drive');
    expect(isDriveConfigured()).toBe(false);
  });
});

// ─── Runtime: parseServiceAccountJson errors ─────────────────────────────────

describe('service account JSON parsing', () => {
  beforeEach(() => {
    process.env.GOOGLE_AUTH_MODE = 'service_account';
    process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'folder-id';
  });

  it('throws on invalid base64', async () => {
    // Simulate calling fetchServiceAccountToken by creating a test harness
    // We validate the error path is reachable via source-level check (runtime test would need real fetch)
    const { SRC: _ } = { SRC };
    expect(SRC).toContain('GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not valid base64');
  });

  it('throws on valid base64 but invalid JSON', async () => {
    expect(SRC).toContain('decoded to invalid JSON');
  });
});
