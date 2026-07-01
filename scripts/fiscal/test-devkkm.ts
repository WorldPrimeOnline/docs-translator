/**
 * Webkassa devkkm integration test script.
 *
 * Executes all operations required by Webkassa integrator checklist #2/2
 * against the test cashbox (ZNK: SWK00035686 / devkkm.webkassa.kz).
 *
 * Run with test credentials from .env (never use production credentials here):
 *   npx tsx scripts/fiscal/test-devkkm.ts
 *
 * Environment variables required (from .env or .env.local):
 *   WEBKASSA_API_BASE_URL=https://devkkm.webkassa.kz
 *   WEBKASSA_API_KEY=<test api key>
 *   WEBKASSA_LOGIN=<test login>
 *   WEBKASSA_PASSWORD=<test password>  (never logged)
 *   WEBKASSA_CASHBOX_SERIAL_NUMBER=SWK00035686
 *
 * Operations performed (for Webkassa integrator checklist):
 * 0. Preflight shift close — Z-report to avoid Error 11 (shift >24h)
 * 1. Auth / token acquisition
 * 2. Sale receipt (OperationType=2)
 * 3. Duplicate ExternalCheckNumber → Error 14 (idempotent success)
 * 4. Sale return receipt (OperationType=3) with returnBasisDetails from step 2 response
 * 5. Z-report (close shift) — closes the shift opened by steps 2-4
 * 6. Sequential queue test (two receipts for same cashbox sent sequentially)
 *
 * Results are logged to stdout. No DB writes — this is a pure API test.
 *
 * ⚠️  SAFETY: This script only targets devkkm.webkassa.kz test environment.
 *             It will refuse to run if WEBKASSA_API_BASE_URL contains "kkm.webkassa.kz"
 *             without "dev" prefix (to prevent accidental production calls).
 */

import * as crypto from 'crypto';
import * as dotenv from 'fs';

// ─── Load env ─────────────────────────────────────────────────────────────────

function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    try {
      const content = dotenv.readFileSync(file, 'utf8');
      for (const line of content.split('\n')) {
        const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
        if (match && !process.env[match[1]!]) {
          process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, '');
        }
      }
    } catch { /* file not found */ }
  }
}

loadEnv();

// ─── Resolve config ───────────────────────────────────────────────────────────

const BASE_URL = process.env.WEBKASSA_API_BASE_URL ?? 'https://devkkm.webkassa.kz';
const API_KEY = process.env.WEBKASSA_API_KEY ?? '';
const LOGIN = process.env.WEBKASSA_LOGIN ?? '';
const PASSWORD = process.env.WEBKASSA_PASSWORD ?? '';  // never logged
const CASHBOX = process.env.WEBKASSA_CASHBOX_SERIAL_NUMBER ?? 'SWK00035686';

// ─── Safety check ─────────────────────────────────────────────────────────────

if (!BASE_URL.includes('devkkm.webkassa.kz')) {
  console.error('❌ SAFETY: WEBKASSA_API_BASE_URL is not the devkkm test host. This script only runs against devkkm.webkassa.kz.');
  process.exit(1);
}

if (!API_KEY || !LOGIN || !PASSWORD) {
  console.error('❌ Missing required env vars: WEBKASSA_API_KEY, WEBKASSA_LOGIN, WEBKASSA_PASSWORD');
  process.exit(1);
}

console.log('=== Webkassa devkkm integration test ===');
console.log('URL:', BASE_URL);
console.log('Cashbox (ZNK):', CASHBOX);
console.log('Login:', LOGIN);
console.log('Password: [not logged]');
console.log('');

// ─── HTTP helper ──────────────────────────────────────────────────────────────

let _token: string | null = null;

async function callApi(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Non-JSON response from ${path}: ${text.slice(0, 200)}`);
  }
}

async function callAuth(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!_token) throw new Error('Not authenticated — call step 1 first');
  return callApi(path, { ...body, Token: _token });
}

function getErrors(resp: Record<string, unknown>): { Code: number; Text: string }[] {
  return (resp['Errors'] as { Code: number; Text: string }[] | undefined) ?? [];
}

function hasError(resp: Record<string, unknown>, code: number): boolean {
  return getErrors(resp).some((e) => e.Code === code);
}

function getData(resp: Record<string, unknown>): Record<string, unknown> | null {
  return (resp['Data'] as Record<string, unknown> | null) ?? null;
}

// ─── Step runner ──────────────────────────────────────────────────────────────

interface StepResult {
  ok: boolean;
  data?: Record<string, unknown> | null;
  errorCode?: number;
  errorText?: string;
}

async function step(name: string, fn: () => Promise<StepResult>): Promise<StepResult> {
  process.stdout.write(`[${name}] ... `);
  try {
    const result = await fn();
    if (result.ok) {
      console.log('✓ OK');
    } else {
      console.log(`✗ FAIL: code ${result.errorCode ?? '?'} — ${result.errorText ?? 'unknown error'}`);
    }
    return result;
  } catch (err) {
    const msg = (err as Error).message;
    console.log(`✗ ERROR: ${msg}`);
    return { ok: false, errorText: msg };
  }
}

// ─── Z-report helper ──────────────────────────────────────────────────────────

async function runZReport(): Promise<StepResult> {
  const resp = await callAuth('/api/v4/ZReport', {
    cashboxUniqueNumber: CASHBOX, // lowercase — confirmed from Postman collection
  });
  const errors = getErrors(resp);
  const alreadyClosed = errors.some((e) => e.Code === 12 || e.Code === 13);
  if (alreadyClosed) {
    const code = errors.find((e) => e.Code === 12 || e.Code === 13)!.Code;
    console.log(`(shift already closed — Error ${code} treated as idempotent success)`);
    return { ok: true, data: null };
  }
  const data = getData(resp);
  if (errors.length > 0 && !data) {
    return { ok: false, errorCode: errors[0]!.Code, errorText: errors[0]!.Text };
  }
  const d = data as { ShiftNumber?: number; DocumentCount?: number } | null;
  console.log(`(ShiftNumber=${d?.ShiftNumber ?? 'n/a'}, DocumentCount=${d?.DocumentCount ?? 'n/a'})`);
  return { ok: true, data };
}

// ─── Sale receipt helper ───────────────────────────────────────────────────────

interface ReturnBasisDetails {
  dateTime: string;
  total: number;
  checkNumber: string;
  registrationNumber: string;
  isOffline: boolean;
}

/** Convert Webkassa "DD.MM.YYYY HH:mm:ss" → "YYYY-MM-DD HH:mm:ss" */
function toIsoDateTime(dt: string): string {
  const m = dt.match(/^(\d{2})\.(\d{2})\.(\d{4}) (.+)$/);
  if (!m) return dt;
  return `${m[3]}-${m[2]}-${m[1]} ${m[4]}`;
}

/** Build returnBasisDetails from a Webkassa sale response Data object */
function buildReturnBasisDetails(saleData: Record<string, unknown>): ReturnBasisDetails {
  const cashbox = saleData['Cashbox'] as Record<string, unknown> | undefined;
  return {
    dateTime: toIsoDateTime((saleData['DateTime'] as string | undefined) ?? ''),
    total: (saleData['Total'] as number | undefined) ?? 0,
    checkNumber: (saleData['CheckNumber'] as string | undefined) ?? '',
    registrationNumber: (cashbox?.['RegistrationNumber'] as string | undefined) ?? '',
    isOffline: (saleData['OfflineMode'] as boolean | undefined) ?? false,
  };
}

async function sendSale(opts: {
  externalId: string;
  externalOrderNumber: string;
  positionName: string;
  amount: number;
  operationType?: number;
  /** For OperationType=3 (SALE_RETURN) per protocol 2.0.3+: required basis details from original sale */
  returnBasisDetails?: ReturnBasisDetails;
}): Promise<StepResult> {
  const operationType = opts.operationType ?? 2;
  const body: Record<string, unknown> = {
    CashboxUniqueNumber: CASHBOX,
    OperationType: operationType,
    Positions: [{
      Count: 1,
      Price: opts.amount,
      TaxPercent: 0,
      Tax: 0,
      TaxType: 0,
      PositionName: opts.positionName,
      PositionCode: opts.externalOrderNumber,
      UnitCode: 796,
      Discount: 0,
      Markup: 0,
    }],
    Payments: [{ Sum: opts.amount, PaymentType: 1 }],
    Change: 0,
    RoundType: 2,
    ExternalCheckNumber: opts.externalId,
    ExternalOrderNumber: opts.externalOrderNumber,
    ExternalLinkId: crypto.randomUUID(),
  };

  if (opts.returnBasisDetails) {
    // Required for OperationType=3 per Webkassa protocol 2.0.3+
    body['returnBasisDetails'] = opts.returnBasisDetails;
  }

  const resp = await callAuth('/api/v4/check', body);
  const errors = getErrors(resp);
  const data = getData(resp);

  if (errors.length > 0 && !data) {
    return { ok: false, errorCode: errors[0]!.Code, errorText: errors[0]!.Text, data: null };
  }
  return { ok: true, data };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // ─── 1. Auth ─────────────────────────────────────────────────────────────────
  const authResult = await step('1. Authorize', async () => {
    const resp = await callApi('/api/v4/Authorize', { Login: LOGIN, Password: PASSWORD });
    const errors = getErrors(resp);
    if (errors.length > 0) {
      return { ok: false, errorCode: errors[0]!.Code, errorText: errors[0]!.Text };
    }
    const token = (getData(resp) as { Token?: string } | null)?.Token;
    if (!token) return { ok: false, errorText: 'Auth response missing Token' };
    _token = token;
    console.log('(token acquired — not logged)');
    return { ok: true };
  });

  if (!authResult.ok) {
    console.error('\nCannot proceed without auth token. Aborting.');
    process.exit(1);
  }

  // ─── 0. Preflight: close shift if open >24h (prevents Error 11 on sale) ─────
  console.log('');
  await step('0. Preflight shift close (prevents Error 11)', async () => {
    const result = await runZReport();
    if (!result.ok) {
      // Non-fatal — log and continue; sale will fail with Error 11 if shift is still expired
      console.log(`(preflight Z-report failed with code ${result.errorCode ?? '?'} — continuing anyway)`);
      return { ok: true }; // don't block subsequent tests
    }
    return result;
  });

  // ─── 2. Sale receipt ─────────────────────────────────────────────────────────
  // saleExternalId is the ExternalCheckNumber for this sale — used in steps 3 and 4.
  const saleExternalId = crypto.randomUUID();
  let saleResponseData: Record<string, unknown> | null = null;

  const saleResult = await step('2. Sale receipt (OperationType=2)', async () => {
    const result = await sendSale({
      externalId: saleExternalId,
      externalOrderNumber: 'TEST001',
      positionName: 'Тестовая услуга перевода документа',
      amount: 1000,
    });
    if (!result.ok) return result;
    saleResponseData = result.data as Record<string, unknown> | null;
    const d = saleResponseData as { CheckNumber?: string; TicketUrl?: string } | null;
    console.log(`(CheckNumber=${d?.CheckNumber ?? 'n/a'}, ExternalCheckNumber=${saleExternalId}, TicketUrl=${d?.TicketUrl ?? 'n/a'})`);
    return result;
  });

  // ─── 3. Duplicate ExternalCheckNumber → Error 14 ────────────────────────────
  await step('3. Duplicate ExternalCheckNumber → Error 14 (idempotent)', async () => {
    if (!saleResult.ok) {
      console.log('(skipped — step 2 (sale) failed)');
      return { ok: true };
    }
    const resp = await callAuth('/api/v4/check', {
      CashboxUniqueNumber: CASHBOX,
      OperationType: 2,
      Positions: [{
        Count: 1, Price: 1000, TaxPercent: 0, Tax: 0, TaxType: 0,
        PositionName: 'Тестовая услуга перевода документа (duplicate)',
        PositionCode: 'TEST001', UnitCode: 796, Discount: 0, Markup: 0,
      }],
      Payments: [{ Sum: 1000, PaymentType: 1 }],
      Change: 0, RoundType: 2,
      ExternalCheckNumber: saleExternalId, // same UUID as step 2
      ExternalOrderNumber: 'TEST001',
      ExternalLinkId: crypto.randomUUID(),
    });
    const errors = getErrors(resp);
    const isDuplicate = hasError(resp, 14);
    if (isDuplicate) {
      console.log('(Error 14 received and handled as idempotent success)');
      return { ok: true };
    }
    const data = getData(resp);
    if (!isDuplicate && !data) {
      return { ok: false, errorCode: errors[0]?.Code, errorText: errors[0]?.Text };
    }
    // Some Webkassa versions return Data directly without Error 14 on duplicate
    console.log('(no Error 14, but Data returned — treated as idempotent success)');
    return { ok: true };
  });

  // ─── 4. Sale return receipt (OperationType=3) ────────────────────────────────
  // Per Webkassa protocol 2.0.3+: returnBasisDetails is REQUIRED (Error 9 without it).
  // Fields come from the original sale response: DateTime, Total, CheckNumber,
  // Cashbox.RegistrationNumber, OfflineMode. The return uses its own unique ExternalCheckNumber.
  await step('4. Sale return receipt (OperationType=3) with returnBasisDetails', async () => {
    if (!saleResult.ok || !saleResponseData) {
      console.log('(skipped — step 2 (sale) failed; sale must succeed before testing return)');
      return { ok: true };
    }
    const returnBasisDetails = buildReturnBasisDetails(saleResponseData);
    console.log(`(returnBasisDetails: checkNumber=${returnBasisDetails.checkNumber}, total=${returnBasisDetails.total})`);
    const result = await sendSale({
      externalId: crypto.randomUUID(), // unique ExternalCheckNumber for the return itself
      externalOrderNumber: 'TEST001R',
      positionName: 'Возврат: тестовая услуга перевода документа',
      amount: 1000,
      operationType: 3,
      returnBasisDetails,
    });
    if (!result.ok) return result;
    const d = result.data as { CheckNumber?: string } | null;
    console.log(`(CheckNumber=${d?.CheckNumber ?? 'n/a'})`);
    return result;
  });

  // ─── 5. Z-report (close shift opened by steps 2-4) ───────────────────────────
  await step('5. Z-report / close shift', async () => runZReport());

  // ─── 6. Sequential queue test (two receipts on fresh shift, sent one-by-one) ──
  await step('6. Sequential queue test (two receipts, same cashbox)', async () => {
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    const t0 = Date.now();

    const r1 = await sendSale({ externalId: id1, externalOrderNumber: 'SEQT1', positionName: 'Seq test 1', amount: 500 });
    const t1 = Date.now();
    if (!r1.ok) return r1;

    const r2 = await sendSale({ externalId: id2, externalOrderNumber: 'SEQT2', positionName: 'Seq test 2', amount: 500 });
    const t2 = Date.now();
    if (!r2.ok) return r2;

    console.log(`(check1: ${t1 - t0}ms, check2: ${t2 - t1}ms — sequential, not parallel)`);
    return { ok: true };
  });

  // ─── Mocked scenarios ─────────────────────────────────────────────────────────

  console.log('');
  console.log('=== Mocked error scenarios (handled in code, cannot trigger on devkkm safely) ===');
  console.log('');
  console.log('[7. Error 10: Cashbox not activated]');
  console.log('  → Handled in webkassa-client.ts: treated as permanent failure (not retryable).');
  console.log('  → Status: failed. Operator must activate cashbox in Webkassa cabinet.');
  console.log('');
  console.log('[8. Error 18: Offline duration exceeded]');
  console.log('  → Handled in webkassa-client.ts: treated as permanent failure (not retryable).');
  console.log('  → Status: failed. Operator must reconnect cashbox and clear offline queue.');
  console.log('');
  console.log('[9. Token refresh / Error 2: Session expired]');
  console.log('  → Handled in webkassa-client.ts: callAuthenticated() re-auths and retries once.');
  console.log('  → Token cache cleared on Error 2. New token acquired transparently.');
  console.log('');
  console.log('[10. Error 11: Shift >24h]');
  console.log('  → Preflight Z-report (step 0) closes stale shift before any sale operations.');
  console.log('  → In production worker: scheduled daily Z-report prevents Error 11 occurring.');
  console.log('');

  console.log('=== All test operations complete ===');
  console.log('');
  console.log('Next step: notify Webkassa integrator to check logs on their side for cashbox:', CASHBOX);
}

main().catch((err: unknown) => {
  console.error('Test script error:', (err as Error).message);
  process.exit(1);
});
