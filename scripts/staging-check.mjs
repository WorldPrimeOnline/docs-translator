#!/usr/bin/env node
/**
 * Staging environment variable checklist.
 * Run: npm run staging:check          (from repo root — web app vars)
 *      npm run staging:check --worker (from repo root — worker vars)
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const isWorker = process.argv.includes('--worker');

// Load .env.local if present (local dev only)
try {
  const envFile = resolve(__dirname, '..', isWorker ? 'worker/.env' : '.env.local');
  const raw = readFileSync(envFile, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
} catch {
  // No local .env file — relying on real env vars
}

const get = (k) => process.env[k] ?? '';
const set = (k) => !!get(k);

function check(label, ok, value, note = '') {
  const icon = ok ? '✅' : '❌';
  const display = value ? ` = ${value.slice(0, 40)}${value.length > 40 ? '…' : ''}` : ' (not set)';
  console.log(`  ${icon} ${label}${display}${note ? `  ← ${note}` : ''}`);
  return ok;
}

let failed = 0;
function req(label, key, note = '') {
  const ok = check(label, set(key), set(key) ? '***' : '', note);
  if (!ok) failed++;
}
function reqVal(label, key, expected, note = '') {
  const val = get(key);
  const ok = !!val && val === expected;
  check(label, ok, val || '(not set)', note);
  if (!ok) failed++;
}
function reqContains(label, key, substr, note = '') {
  const val = get(key);
  const ok = val.includes(substr);
  check(label, ok, val || '(not set)', note);
  if (!ok) failed++;
}
function reqNotContains(label, key, substr, note = '') {
  const val = get(key);
  const ok = !!val && !val.includes(substr);
  check(label, ok, val || '(not set)', note);
  if (!ok) failed++;
}
function info(label, key) {
  const val = get(key);
  console.log(`  ℹ️  ${label} = ${val || '(not set)'}`);
}

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log(isWorker ? '  WPO Worker — Staging Env Check' : '  WPO Web App — Staging Env Check');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

if (isWorker) {
  console.log('── Worker identity ──────────────────────────────────────');
  reqVal('APP_ENV', 'APP_ENV', 'staging', 'must be "staging"');

  console.log('── Supabase ─────────────────────────────────────────────');
  req('NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  req('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');

  console.log('── R2 ───────────────────────────────────────────────────');
  req('R2_ACCOUNT_ID', 'R2_ACCOUNT_ID');
  req('R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID');
  req('R2_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY');
  reqContains('R2_BUCKET_NAME', 'R2_BUCKET_NAME', 'staging', 'must contain "staging"');

  console.log('── AI APIs ──────────────────────────────────────────────');
  req('ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY');
  req('MISTRAL_API_KEY', 'MISTRAL_API_KEY');

  console.log('── Email ────────────────────────────────────────────────');
  req('RESEND_API_KEY', 'RESEND_API_KEY');
  info('EMAILS_ENABLED', 'EMAILS_ENABLED');
  info('EMAIL_REDIRECT_ALL_TO', 'EMAIL_REDIRECT_ALL_TO');
  const emailsEnabled = get('EMAILS_ENABLED') !== 'false';
  const hasRedirect = !!get('EMAIL_REDIRECT_ALL_TO');
  if (emailsEnabled && !hasRedirect) {
    console.log('  ⚠️  EMAILS_ENABLED=true without EMAIL_REDIRECT_ALL_TO — real emails may be sent!');
    failed++;
  }

  console.log('── Payments ─────────────────────────────────────────────');
  reqVal('PAYMENTS_MODE', 'PAYMENTS_MODE', 'test', 'must be "test" in staging');

  console.log('── Site URL ─────────────────────────────────────────────');
  req('SITE_URL', 'SITE_URL');
} else {
  console.log('── App identity ─────────────────────────────────────────');
  reqVal('NEXT_PUBLIC_APP_ENV', 'NEXT_PUBLIC_APP_ENV', 'staging', 'must be "staging"');

  console.log('── Supabase ─────────────────────────────────────────────');
  req('NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL');
  req('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  req('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY');

  console.log('── R2 ───────────────────────────────────────────────────');
  req('R2_ACCOUNT_ID', 'R2_ACCOUNT_ID');
  req('R2_ACCESS_KEY_ID', 'R2_ACCESS_KEY_ID');
  req('R2_SECRET_ACCESS_KEY', 'R2_SECRET_ACCESS_KEY');
  reqContains('R2_BUCKET_NAME', 'R2_BUCKET_NAME', 'staging', 'must contain "staging"');

  console.log('── AI APIs ──────────────────────────────────────────────');
  req('ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY');
  req('MISTRAL_API_KEY', 'MISTRAL_API_KEY');

  console.log('── Email ────────────────────────────────────────────────');
  info('EMAILS_ENABLED', 'EMAILS_ENABLED');
  info('EMAIL_REDIRECT_ALL_TO', 'EMAIL_REDIRECT_ALL_TO');

  console.log('── Payments ─────────────────────────────────────────────');
  reqVal('PAYMENTS_MODE', 'PAYMENTS_MODE', 'test', 'must be "test" in staging');

  console.log('── Site URL ─────────────────────────────────────────────');
  req('NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_SITE_URL');
}

console.log('');
if (failed === 0) {
  console.log('✅ All checks passed — staging environment looks correct.');
} else {
  console.log(`❌ ${failed} check(s) failed — fix the above before deploying to staging.`);
  process.exit(1);
}
console.log('');
