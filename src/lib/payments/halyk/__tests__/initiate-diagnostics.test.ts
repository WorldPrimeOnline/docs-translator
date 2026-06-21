/**
 * @jest-environment node
 *
 * Source-level diagnostics tests for the Halyk initiate route and pay button.
 * These verify structural invariants that caused the 502 bug:
 *   1. catch block must capture the error parameter (no bare `catch {}`)
 *   2. button must not use green/emerald brand colors
 *   3. structured error codes are present in responses
 *   4. client.ts reads response body on HTTP error
 *   5. structured logging is present with required fields
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const cwd = process.cwd();

function read(rel: string): string {
  return readFileSync(join(cwd, rel), 'utf-8');
}

const initiateSrc = read('src/app/api/payments/halyk/initiate/route.ts');
const clientSrc = read('src/lib/payments/halyk/client.ts');
const buttonSrc = read('src/components/payment/HalykPayButton.tsx');

describe('halyk initiate route — structural invariants', () => {
  it('token-acquisition catch block captures error parameter', () => {
    // The 502 bug was caused by `catch {}` swallowing the error details.
    // The fix: the catch that wraps createPaymentToken() uses `catch (err)`.
    // The route source contains `} catch (err) {` before the HalykApiError check.
    expect(initiateSrc).toContain('} catch (err) {');
  });

  it('returns HALYK_TOKEN_FAILED error code on token failure', () => {
    expect(initiateSrc).toContain('HALYK_TOKEN_FAILED');
  });

  it('returns PAYMENT_NOT_CONFIGURED when config is disabled', () => {
    expect(initiateSrc).toContain('PAYMENT_NOT_CONFIGURED');
  });

  it('returns APP_BASE_URL_INVALID when base URL is missing or not HTTPS', () => {
    expect(initiateSrc).toContain('APP_BASE_URL_INVALID');
  });

  it('returns JOB_NOT_FOUND error code', () => {
    expect(initiateSrc).toContain('JOB_NOT_FOUND');
  });

  it('returns PRICE_NOT_SET error code', () => {
    expect(initiateSrc).toContain('PRICE_NOT_SET');
  });

  it('returns PAYMENT_ALREADY_PENDING error code', () => {
    expect(initiateSrc).toContain('PAYMENT_ALREADY_PENDING');
  });

  it('includes correlationId in token-failure response', () => {
    // All error responses should include correlationId for tracing
    const idx = initiateSrc.indexOf('HALYK_TOKEN_FAILED');
    const snippet = initiateSrc.slice(idx, idx + 120);
    expect(snippet).toContain('correlationId');
  });

  it('logs oauthUrlHost and mode (not the secret) on token failure', () => {
    expect(initiateSrc).toContain('oauthUrlHost');
    expect(initiateSrc).toContain('mode: config.mode');
    // Must never log the raw clientSecret value
    expect(initiateSrc).not.toContain('config.clientSecret');
  });

  it('logs config presence flags without exposing values', () => {
    expect(initiateSrc).toContain('clientSecretPresent: !!process.env.HALYK_EPAY_CLIENT_SECRET');
    expect(initiateSrc).toContain('clientIdPresent: !!process.env.HALYK_EPAY_CLIENT_ID');
    expect(initiateSrc).toContain('terminalIdPresent: !!process.env.HALYK_EPAY_TERMINAL_ID');
  });
});

describe('halyk client.ts — response body on HTTP error', () => {
  it('reads response body snippet when Halyk returns non-2xx', () => {
    // The original bug: error was thrown before reading body, losing diagnostic info.
    // Fix: read body before throw on !response.ok path.
    expect(clientSrc).toContain('bodySnippet');
    expect(clientSrc).toContain("await response.text()");
    expect(clientSrc).toContain('responseBodySnippet');
  });

  it('HalykApiError constructor accepts responseBodySnippet as 4th param', () => {
    expect(clientSrc).toContain('public readonly responseBodySnippet');
  });
});

describe('HalykPayButton — brand color compliance', () => {
  it('does not use emerald button color classes', () => {
    // Emerald was the wrong brand color; WPO uses gold (bg-primary).
    expect(buttonSrc).not.toContain('bg-emerald-600');
    expect(buttonSrc).not.toContain('bg-emerald-700');
    expect(buttonSrc).not.toContain('hover:bg-emerald-');
  });

  it('uses WPO primary (gold) color for the pay button', () => {
    expect(buttonSrc).toContain('bg-primary');
    expect(buttonSrc).toContain('hover:bg-gold-dark');
    expect(buttonSrc).toContain('text-primary-foreground');
  });

  it('maps 502 responses to gatewayError key', () => {
    expect(buttonSrc).toContain("response.status === 502");
    expect(buttonSrc).toContain("'gatewayError'");
  });

  it('does not expose error body parsing to the user (only uses error key)', () => {
    // The button should read the error code for display key selection,
    // but must never display raw server error messages.
    expect(buttonSrc).not.toContain('respBody.message');
    expect(buttonSrc).not.toContain('errorBody.message');
  });
});
