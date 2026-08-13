/**
 * @jest-environment node
 *
 * Structural tests for the card-payments entity gate added when Halyk ePay
 * acquiring was not yet migrated to the new legal entity (ТОО World Prime Online).
 * Same structural-test convention as status-finalization.test.ts — Supabase/HTTP
 * cannot be meaningfully mocked at unit level for this route.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BUSINESS_PROFILE } from '@/lib/business-profile';
// Not importing PaymentComplianceBlock directly — it pulls in 'next-intl/server',
// whose ESM build this node-environment structural-test config can't transform
// (same reason status-finalization.test.ts reads route sources as text). Source-text
// assertions below cover the same invariants without executing the component.

const initiateSrc = fs.readFileSync(
  path.join(process.cwd(), 'src/app/api/payments/halyk/initiate/route.ts'),
  'utf-8',
);

describe('halyk initiate route — entity gate', () => {
  it('checks BUSINESS_PROFILE.cardPaymentsActive before any other gate', () => {
    const entityGateIndex = initiateSrc.indexOf('BUSINESS_PROFILE.cardPaymentsActive');
    const configGateIndex = initiateSrc.indexOf('config.enabled');
    const tokenCallIndex = initiateSrc.indexOf('createPaymentToken(');
    expect(entityGateIndex).toBeGreaterThan(-1);
    expect(entityGateIndex).toBeLessThan(configGateIndex);
    expect(entityGateIndex).toBeLessThan(tokenCallIndex);
  });

  it('returns 503 CARD_PAYMENTS_INACTIVE without calling Halyk', () => {
    expect(initiateSrc).toContain('CARD_PAYMENTS_INACTIVE');
    expect(initiateSrc).toContain("status: 503");
  });

  it('BUSINESS_PROFILE.cardPaymentsActive is currently false (Halyk not migrated to new entity)', () => {
    expect(BUSINESS_PROFILE.cardPaymentsActive).toBe(false);
  });
});

describe('HalykPayButton — payments-enabled gate', () => {
  const buttonSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/payment/HalykPayButton.tsx'),
    'utf-8',
  );

  it('gates on both NEXT_PUBLIC_HALYK_EPAY_ENABLED and BUSINESS_PROFILE.cardPaymentsActive', () => {
    expect(buttonSrc).toContain("process.env.NEXT_PUBLIC_HALYK_EPAY_ENABLED !== 'false'");
    expect(buttonSrc).toContain('BUSINESS_PROFILE.cardPaymentsActive');
  });

  it('autoStart effect does not fire handlePay when payments are disabled', () => {
    expect(buttonSrc).toContain('if (autoStart && PAYMENTS_ENABLED) void handlePay();');
  });

  it('handlePay no-ops when payments are disabled (defense in depth)', () => {
    expect(buttonSrc).toContain('if (!PAYMENTS_ENABLED) return;');
  });
});

describe('PaymentComplianceBlock — hides active-Halyk wording when not live', () => {
  const blockSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/components/payment/PaymentComplianceBlock.tsx'),
    'utf-8',
  );

  it('exports isHalykComplianceVisible gating on PAYMENTS_ENABLED && cardPaymentsActive', () => {
    expect(blockSrc).toContain('export function isHalykComplianceVisible(): boolean {');
    expect(blockSrc).toContain('return PAYMENTS_ENABLED && BUSINESS_PROFILE.cardPaymentsActive;');
  });

  it('returns null (renders nothing) when not live — no message in the global footer', () => {
    expect(blockSrc).toContain('if (!isHalykComplianceVisible()) return null;');
    // Must not fall back to showing the payment-unavailable message itself — that
    // belongs only in an actual payment context (HalykPayButton), not the footer.
    expect(blockSrc).not.toContain("paymentT('unavailable')");
    expect(blockSrc).not.toContain("t('unavailable')");
  });

  it('isHalykComplianceVisible() evaluates to false today (cardPaymentsActive is false)', () => {
    // isHalykComplianceVisible() = PAYMENTS_ENABLED && BUSINESS_PROFILE.cardPaymentsActive.
    // PAYMENTS_ENABLED defaults to true (env var unset in this test run), so the
    // overall result today is governed by cardPaymentsActive, already asserted false above.
    expect(BUSINESS_PROFILE.cardPaymentsActive).toBe(false);
  });
});

describe('Footer layout — collapses to 2 columns when payment compliance is hidden', () => {
  const layoutSrc = fs.readFileSync(
    path.join(process.cwd(), 'src/app/[locale]/layout.tsx'),
    'utf-8',
  );

  it('imports isHalykComplianceVisible and computes showPaymentCompliance', () => {
    expect(layoutSrc).toContain('isHalykComplianceVisible');
    expect(layoutSrc).toContain('const showPaymentCompliance = isHalykComplianceVisible();');
  });

  it('uses a 3-column grid when visible and a 2-column grid when hidden', () => {
    expect(layoutSrc).toContain("showPaymentCompliance ? 'md:grid-cols-[2fr_1fr_1.5fr]' : 'md:grid-cols-[2fr_1fr]'");
  });

  it('keeps the sm breakpoint (mobile/tablet responsive behavior) unconditional', () => {
    expect(layoutSrc).toContain('sm:grid-cols-2');
  });

  it('only renders the third column when payment compliance is visible', () => {
    expect(layoutSrc).toContain('{showPaymentCompliance && <PaymentComplianceBlock variant="footer-column" />}');
  });
});
