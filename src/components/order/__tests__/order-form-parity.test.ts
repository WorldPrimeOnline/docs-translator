/**
 * Static guard against the exact regression this test was written for: the public
 * pre-checkout wizard (/[locale]/start) drifting into a hand-made approximation of the
 * dashboard order form instead of rendering the same shared component. Both call sites
 * must render src/components/order/OrderForm.tsx — there must be no second, parallel
 * form implementation for the public route.
 */
import fs from 'fs';
import path from 'path';

const ORDER_DIR = path.join(__dirname, '..');
const DASHBOARD_PAGE = path.join(__dirname, '..', '..', '..', 'app', '[locale]', 'dashboard', 'page.tsx');

function read(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

describe('dashboard and the public start wizard render the same OrderForm', () => {
  it('dashboard/page.tsx renders <OrderForm mode="dashboard" .../>', () => {
    const src = read(DASHBOARD_PAGE);
    expect(src).toMatch(/<OrderForm\s+mode="dashboard"/);
  });

  it('OrderWizard.tsx (used only by /[locale]/start) renders <OrderForm mode="publicStart" .../>', () => {
    const src = read(path.join(ORDER_DIR, 'OrderWizard.tsx'));
    expect(src).toMatch(/<OrderForm\s*\n?\s*mode="publicStart"/);
  });

  it('dashboard/page.tsx no longer defines its own duplicate order-form JSX/state', () => {
    const src = read(DASHBOARD_PAGE);
    // These identifiers belonged exclusively to the extracted form and must not
    // reappear in dashboard/page.tsx — their presence would mean the form was
    // re-forked instead of shared.
    expect(src).not.toContain('ServiceLevelCard');
    expect(src).not.toContain("useState<ServiceLevel>('electronic')");
    expect(src).not.toContain('handleSubmit');
  });
});

describe('OrderForm includes the partner/promo code field, unconditionally reachable in both modes', () => {
  it('references the promo code label and apply/validate-code flow', () => {
    const src = read(path.join(ORDER_DIR, 'OrderForm.tsx'));
    expect(src).toContain("t('promoCode.label')");
    expect(src).toContain('/api/partners/validate-code');
  });

  it('the promo code block is not gated behind a mode check', () => {
    const src = read(path.join(ORDER_DIR, 'OrderForm.tsx'));
    const idx = src.indexOf("t('promoCode.label')");
    expect(idx).toBeGreaterThan(-1);
    const precedingWindow = src.slice(Math.max(0, idx - 600), idx);
    expect(precedingWindow).not.toMatch(/mode\s*===\s*['"](dashboard|publicStart)['"]\s*&&/);
    expect(precedingWindow).not.toMatch(/\{mode\s*===\s*['"]dashboard['"]\s*\?/);
  });

  it('the button copy is always "uploadDocument" (dashboard\'s existing label), never a "calculate price" label', () => {
    const src = read(path.join(ORDER_DIR, 'OrderForm.tsx'));
    expect(src).toContain("t('uploadDocument')");
    expect(src).not.toMatch(/calculateButton|Рассчитать стоимость/);
  });
});

describe('public /start uses the same container as /dashboard', () => {
  it('start/layout.tsx uses the same max-w-4xl container as dashboard/layout.tsx', () => {
    const dashboardLayout = read(path.join(__dirname, '..', '..', '..', 'app', '[locale]', 'dashboard', 'layout.tsx'));
    const startLayout = read(path.join(__dirname, '..', '..', '..', 'app', '[locale]', 'start', 'layout.tsx'));
    const extractContainerClass = (src: string): string | null => {
      const m = src.match(/<main className="([^"]+)"/);
      return m ? m[1]! : null;
    };
    const dashboardClass = extractContainerClass(dashboardLayout);
    const startClass = extractContainerClass(startLayout);
    expect(dashboardClass).not.toBeNull();
    expect(startClass).toBe(dashboardClass);
  });
});
