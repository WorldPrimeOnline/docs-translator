/**
 * Generates a new Google OAuth refresh token for the Drive integration.
 *
 * Usage:
 *   npx tsx scripts/refresh-google-drive-token.ts
 *
 * Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local
 * (the same vars already set for the app).
 *
 * After running:
 *   1. Visit the printed URL in a browser and authorize access
 *   2. Paste the authorization code when prompted
 *   3. Copy the printed GOOGLE_REFRESH_TOKEN value to Railway env vars
 */

import * as readline from 'readline';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://127.0.0.1:8080/oauth2callback';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env.local');
  process.exit(1);
}

const SCOPES = [
  'https://www.googleapis.com/auth/drive',
].join(' ');

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent'); // force new refresh token

console.log('\n=== Google Drive OAuth Token Refresh ===\n');
console.log('1. Open this URL in a browser:\n');
console.log(authUrl.toString());
console.log('\n2. Authorize the app with the Google account that owns the Drive folder.');
console.log('3. Copy the authorization code shown on the page.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('Paste the authorization code here: ', async (code: string) => {
  rl.close();
  const trimmedCode = code.trim();
  if (!trimmedCode) {
    console.error('No code provided.');
    process.exit(1);
  }

  try {
    const body = new URLSearchParams({
      code: trimmedCode,
      client_id: CLIENT_ID!,
      client_secret: CLIENT_SECRET!,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
    });

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`Token exchange failed (${res.status}):`, text);
      process.exit(1);
    }

    const tokens = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      token_type: string;
      expires_in: number;
    };

    if (!tokens.refresh_token) {
      console.error('\nNo refresh_token in response — try revoking app access first:');
      console.error('  https://myaccount.google.com/permissions');
      console.error('Then re-run this script.\n');
      process.exit(1);
    }

    console.log('\n=== SUCCESS ===\n');
    console.log('Set this env var on Railway (worker service):\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\nKeep GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET unchanged.');
  } catch (err) {
    console.error('Unexpected error:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
});
