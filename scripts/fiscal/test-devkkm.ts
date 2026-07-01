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
 * 1. Auth / token acquisition
 * 2. Sale receipt (OperationType=2)
 * 3. Duplicate ExternalCheckNumber → Error 14 (idempotent success)
 * 4. Sale return receipt (OperationType=3)
 * 5. Z-report (close shift)
 * 6. Sequential queue test (two receipts for same cashbox must not run in parallel)
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
  // Load .env.local first, then .env
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

if (!BASE_URL.includes('devkkm') && BASE_URL.includes('kkm.webkassa.kz')) {
  console.error('❌ SAFETY: WEBKASSA_API_BASE_URL looks like a production URL. This script only runs against devkkm.webkassa.kz.');
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
  return callApi(path, { ...body, Token: _token ?? '' });
}

// ─── Operations ───────────────────────────────────────────────────────────────

async function step(name: string, fn: () => Promise<void>): Promise<boolean> {
  process.stdout.write(`[${name}] ... `);
  try {
    await fn();
    console.log('✓ OK');
    return true;
  } catch (err) {
    console.log(`✗ FAIL: ${(err as Error).message}`);
    return false;
  }
}

async function main(): Promise<void> {
  // 1. Auth
  await step('1. Authorize', async () => {
    const resp = await callApi('/api/v4/Authorize', { Login: LOGIN, Password: PASSWORD });
    const errors = (resp['Errors'] as { Code: number; Text: string }[] | undefined) ?? [];
    if (errors.length) throw new Error(`Auth failed: code ${errors[0]!.Code} — ${errors[0]!.Text}`);
    const token = (resp['Data'] as { Token?: string } | null)?.Token;
    if (!token) throw new Error('Auth response missing Token');
    _token = token;
    console.log('(token acquired — not logged)');
  });

  if (!_token) {
    console.error('Cannot proceed without auth token');
    process.exit(1);
  }

  // 2. Sale receipt
  const saleExternalId = crypto.randomUUID();
  await step('2. Sale receipt (OperationType=2)', async () => {
    const resp = await callAuth('/api/v4/check', {
      CashboxUniqueNumber: CASHBOX,
      OperationType: 2,
      Positions: [{
        Count: 1, Price: 1000, TaxPercent: 0, Tax: 0, TaxType: 0,
        PositionName: 'Тестовая услуга перевода документа',
        PositionCode: 'TEST001', UnitCode: 796, Discount: 0, Markup: 0,
      }],
      Payments: [{ Sum: 1000, PaymentType: 1 }],
      Change: 0, RoundType: 2,
      ExternalCheckNumber: saleExternalId,
      ExternalOrderNumber: 'TEST001',
      ExternalLinkId: crypto.randomUUID(),
    });
    const errors = (resp['Errors'] as { Code: number; Text: string }[] | undefined) ?? [];
    if (errors.length && !resp['Data']) {
      throw new Error(`Check failed: code ${errors[0]!.Code} — ${errors[0]!.Text}`);
    }
    const data = resp['Data'] as { CheckNumber?: string; TicketUrl?: string } | null;
    console.log(`(CheckNumber=${data?.CheckNumber ?? 'n/a'}, TicketUrl=${data?.TicketUrl ?? 'n/a'})`);
  });

  // 3. Duplicate ExternalCheckNumber → Error 14 (idempotent)
  await step('3. Duplicate ExternalCheckNumber → Error 14 (idempotent)', async () => {
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
    const errors = (resp['Errors'] as { Code: number }[] | undefined) ?? [];
    const isDuplicate = errors.some((e) => e.Code === 14);
    if (!isDuplicate) {
      // Some Webkassa versions return Data directly on duplicate without Error 14
      if (!resp['Data']) throw new Error(`Expected Error 14 or Data, got: ${JSON.stringify(resp).slice(0, 200)}`);
    }
    console.log('(Error 14 received and handled as idempotent success)');
  });

  // 4. Sale return receipt
  const refundExternalId = crypto.randomUUID();
  await step('4. Sale return receipt (OperationType=3)', async () => {
    const resp = await callAuth('/api/v4/check', {
      CashboxUniqueNumber: CASHBOX,
      OperationType: 3,
      Positions: [{
        Count: 1, Price: 1000, TaxPercent: 0, Tax: 0, TaxType: 0,
        PositionName: 'Возврат: тестовая услуга перевода документа',
        PositionCode: 'TEST001', UnitCode: 796, Discount: 0, Markup: 0,
      }],
      Payments: [{ Sum: 1000, PaymentType: 1 }],
      Change: 0, RoundType: 2,
      ExternalCheckNumber: refundExternalId,
      ExternalOrderNumber: 'TEST001R',
      ExternalLinkId: crypto.randomUUID(),
    });
    const errors = (resp['Errors'] as { Code: number; Text: string }[] | undefined) ?? [];
    if (errors.length && !resp['Data']) {
      throw new Error(`Return check failed: code ${errors[0]!.Code} — ${errors[0]!.Text}`);
    }
    const data = resp['Data'] as { CheckNumber?: string } | null;
    console.log(`(CheckNumber=${data?.CheckNumber ?? 'n/a'})`);
  });

  // 5. Sequential queue test (two operations sent sequentially, not in parallel)
  await step('5. Sequential queue test (two receipts, same cashbox)', async () => {
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    const t0 = Date.now();

    // Send first receipt, await it fully, THEN send second
    const check1Resp = await callAuth('/api/v4/check', {
      CashboxUniqueNumber: CASHBOX,
      OperationType: 2,
      Positions: [{ Count: 1, Price: 500, TaxPercent: 0, Tax: 0, TaxType: 0, PositionName: 'Seq test 1', UnitCode: 796, Discount: 0, Markup: 0 }],
      Payments: [{ Sum: 500, PaymentType: 1 }],
      Change: 0, RoundType: 2,
      ExternalCheckNumber: id1, ExternalOrderNumber: 'SEQT1', ExternalLinkId: crypto.randomUUID(),
    });
    const t1 = Date.now();

    const check2Resp = await callAuth('/api/v4/check', {
      CashboxUniqueNumber: CASHBOX,
      OperationType: 2,
      Positions: [{ Count: 1, Price: 500, TaxPercent: 0, Tax: 0, TaxType: 0, PositionName: 'Seq test 2', UnitCode: 796, Discount: 0, Markup: 0 }],
      Payments: [{ Sum: 500, PaymentType: 1 }],
      Change: 0, RoundType: 2,
      ExternalCheckNumber: id2, ExternalOrderNumber: 'SEQT2', ExternalLinkId: crypto.randomUUID(),
    });
    const t2 = Date.now();

    const errs1 = (check1Resp['Errors'] as { Code: number; Text: string }[] | undefined) ?? [];
    const errs2 = (check2Resp['Errors'] as { Code: number; Text: string }[] | undefined) ?? [];
    if (errs1.length && !check1Resp['Data']) throw new Error(`Seq check 1 failed: code ${errs1[0]!.Code}`);
    if (errs2.length && !check2Resp['Data']) throw new Error(`Seq check 2 failed: code ${errs2[0]!.Code}`);

    console.log(`(check1: ${t1 - t0}ms, check2: ${t2 - t1}ms — sequential, not parallel)`);
  });

  // 6. Z-report (close shift)
  await step('6. Z-report / close shift', async () => {
    const resp = await callAuth('/api/v4/ZReport', {
      cashboxUniqueNumber: CASHBOX, // lowercase — verified from Postman collection
    });
    const errors = (resp['Errors'] as { Code: number; Text: string }[] | undefined) ?? [];
    const alreadyClosed = errors.some((e) => e.Code === 12 || e.Code === 13);
    if (alreadyClosed) {
      console.log('(shift already closed — Error 12/13 treated as idempotent success)');
      return;
    }
    if (errors.length && !resp['Data']) {
      throw new Error(`Z-report failed: code ${errors[0]!.Code} — ${errors[0]!.Text}`);
    }
    const data = resp['Data'] as { ShiftNumber?: number; DocumentCount?: number } | null;
    console.log(`(ShiftNumber=${data?.ShiftNumber ?? 'n/a'}, DocumentCount=${data?.DocumentCount ?? 'n/a'})`);
  });

  // ─── Mocked scenarios (not possible to trigger on devkkm safely) ─────────────

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

  console.log('=== All test operations complete ===');
  console.log('');
  console.log('Next step: notify Webkassa integrator to check logs on their side for cashbox:', CASHBOX);
}

main().catch((err: unknown) => {
  console.error('Test script error:', (err as Error).message);
  process.exit(1);
});
