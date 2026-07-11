/**
 * @jest-environment jsdom
 *
 * Regression tests for the "draft checkout is a payment bridge, not a second
 * confirmation screen" fix. Before this fix, CheckoutClient re-rendered its own
 * "Confirm your order" title, terms checkbox, and "Pay {amount}" button even
 * though the /start price-ready panel (OrderWizard.tsx) already showed price,
 * discount, and consent. These tests assert those never render for a draft
 * whose consent was already recorded, and that an unconsented draft refuses to
 * silently continue.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import orderEn from '../../../../messages/en/order.json';
import checkoutEn from '../../../../messages/en/checkout.json';

let mockDraftId: string | null = 'draft-1';

jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => (key === 'draftId' ? mockDraftId : null) }),
}));

jest.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (key: string) => {
    const dict = namespace === 'startWizard' ? orderEn.startWizard : (checkoutEn as Record<string, unknown>).payment;
    return (dict as Record<string, string>)[key] ?? key;
  },
}));

jest.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

jest.mock('@/components/payment/HalykPayButton', () => ({
  HalykPayButton: (props: { jobId: string; quoteId: string; priceKzt: number; autoStart?: boolean; loadingLabel?: string }) => (
    <div
      data-testid="halyk-pay-button"
      data-job-id={props.jobId}
      data-quote-id={props.quoteId}
      data-price-kzt={props.priceKzt}
      data-auto-start={String(props.autoStart)}
    >
      {props.loadingLabel}
    </div>
  ),
}));

import { CheckoutClient } from '../CheckoutClient';

const FORBIDDEN_STRINGS = [
  'Confirm your order',
  'Review your order before payment.',
  'I accept the Terms of Service and Privacy Policy',
];

function mockFetchByPath(handlers: Record<string, { ok?: boolean; status?: number; body?: unknown }>) {
  (global.fetch as jest.Mock).mockImplementation((url: string) => {
    const match = Object.entries(handlers).find(([path]) => url.includes(path));
    if (!match) return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    const [, res] = match;
    return Promise.resolve({
      ok: res.ok ?? true,
      status: res.status ?? 200,
      json: () => Promise.resolve(res.body ?? {}),
    });
  });
}

beforeEach(() => {
  mockDraftId = 'draft-1';
  global.fetch = jest.fn();
});

describe('CheckoutClient — draft checkout is a payment bridge', () => {
  it('renders no confirm/terms/pay screen and no checkbox while loading, before any fetch resolves', async () => {
    mockFetchByPath({}); // falls through to the default 404 response below
    const { container } = render(<CheckoutClient />);

    // Synchronous initial render — the fetch promises haven't resolved yet.
    for (const text of FORBIDDEN_STRINGS) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(screen.queryByTestId('halyk-pay-button')).not.toBeInTheDocument();

    // Let the pending fetch settle (draftNotFound, from the unmatched-path 404 default)
    // so this test doesn't leak a state update into whichever test runs next.
    await waitFor(() => expect(screen.getByText(orderEn.startWizard.draftNotFound)).toBeInTheDocument());
  });

  it('auto-converts and auto-starts payment for a draft with already-accepted consent, with no confirm/terms/pay screen at any point', async () => {
    mockFetchByPath({
      '/attach': { ok: true, body: {} },
      '/convert': { ok: true, body: { jobId: 'job-1', quoteId: 'quote-1', priceKzt: 1440, currency: 'KZT' } },
      // GET /api/order-drafts/draft-1 (not /attach, not /convert)
      '/api/order-drafts/draft-1': { ok: true, body: { draft: { consent_accepted_at: '2026-01-01T00:00:00.000Z' } } },
    });

    render(<CheckoutClient />);

    const button = await waitFor(() => screen.getByTestId('halyk-pay-button'));
    expect(button.dataset.jobId).toBe('job-1');
    expect(button.dataset.quoteId).toBe('quote-1');
    expect(button.dataset.priceKzt).toBe('1440');
    expect(button.dataset.autoStart).toBe('true');

    for (const text of FORBIDDEN_STRINGS) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    expect(screen.queryByText(/^Pay /)).not.toBeInTheDocument();

    const convertCalls = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/convert'));
    expect(convertCalls).toHaveLength(1); // idempotency guard — never double-called
  });

  it('preserves the discounted final amount from conversion as the Halyk payment amount', async () => {
    mockFetchByPath({
      '/attach': { ok: true, body: {} },
      '/convert': { ok: true, body: { jobId: 'job-2', quoteId: 'quote-2', priceKzt: 8500, currency: 'KZT' } },
      '/api/order-drafts/draft-1': { ok: true, body: { draft: { consent_accepted_at: '2026-01-01T00:00:00.000Z' } } },
    });

    render(<CheckoutClient />);

    const button = await waitFor(() => screen.getByTestId('halyk-pay-button'));
    // 8500 is what /convert returned (the already-discounted amount) — the component
    // must pass it straight through, never recompute or fall back to a pre-discount figure.
    expect(button.dataset.priceKzt).toBe('8500');
  });

  it('refuses to silently continue when the draft has no recorded consent — shows an error and links back to /start', async () => {
    mockFetchByPath({
      '/attach': { ok: true, body: {} },
      '/api/order-drafts/draft-1': { ok: true, body: { draft: { consent_accepted_at: null } } },
    });

    render(<CheckoutClient />);

    await waitFor(() => expect(screen.getByRole('link')).toBeInTheDocument());
    const link = screen.getByRole('link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/start');

    expect(screen.queryByTestId('halyk-pay-button')).not.toBeInTheDocument();
    for (const text of FORBIDDEN_STRINGS) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
    const convertCalls = (global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url).includes('/convert'));
    expect(convertCalls).toHaveLength(0); // never attempts conversion without consent
  });

  it('shows an error and a link back to /start when there is no draftId at all (pre-existing behavior, unchanged)', async () => {
    mockDraftId = null;
    render(<CheckoutClient />);

    await waitFor(() => expect(screen.getByRole('link')).toBeInTheDocument());
    expect((screen.getByRole('link') as HTMLAnchorElement).getAttribute('href')).toBe('/start');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
