/**
 * @jest-environment jsdom
 *
 * Regression test for the 2026-08-20 infinite-spinner incident: the Freedom Pay
 * status route was reading the wrong field from get_status3.php (pg_result instead
 * of pg_payment_status), so a provider-confirmed failure never reached this page as
 * a terminal 'failed' status — the customer saw an endless "processing" spinner.
 * The backend fix is covered by status-map.test.ts and routes-structural.test.ts;
 * this test proves the frontend's own existing logic (unchanged) correctly stops
 * polling and shows the failure UI once the status endpoint actually returns
 * status:'failed', isTerminal:true.
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';

let mockSearchParams: Record<string, string | null> = { payment: 'pay-1', provider: 'freedom_pay' };

jest.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: (key: string) => mockSearchParams[key] ?? null }),
}));

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

jest.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

jest.mock('@/lib/analytics/yandex-metrica', () => ({
  trackPurchaseOnce: jest.fn(),
  readCheckoutServiceLevel: jest.fn(() => null),
}));

import PaymentResultPage from '../page';

function jsonResponse(body: unknown) {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
}

beforeEach(() => {
  mockSearchParams = { payment: 'pay-1', provider: 'freedom_pay' };
  global.fetch = jest.fn();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('PaymentResultPage — polls the Freedom Pay status endpoint when provider=freedom_pay', () => {
  it('queries /api/payments/freedompay/status/<id>, not the Halyk endpoint', async () => {
    (global.fetch as jest.Mock).mockImplementation(() => jsonResponse({
      paymentId: 'pay-1', status: 'payment_pending', amount: 1500, currency: 'KZT',
      paidAt: null, failedAt: null, jobId: 'job-1', isTerminal: false,
    }));

    await act(async () => {
      render(<PaymentResultPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(global.fetch).toHaveBeenCalled();
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('/api/payments/freedompay/status/pay-1');
  });
});

describe('PaymentResultPage — stops polling and shows failure once the status endpoint reports a terminal failure', () => {
  it('shows the failed UI and never issues another fetch after status becomes failed/isTerminal', async () => {
    let callCount = 0;
    (global.fetch as jest.Mock).mockImplementation(() => {
      callCount += 1;
      if (callCount === 1) {
        // Initial fetch — matches the real pre-fix bug state (stuck payment_pending).
        return jsonResponse({
          paymentId: 'pay-1', status: 'payment_pending', amount: 1500, currency: 'KZT',
          paidAt: null, failedAt: null, jobId: 'job-1', isTerminal: false,
        });
      }
      // Any subsequent poll — matches the fixed backend: get_status3.php's
      // pg_payment_status=error correctly reconciled to a terminal local failure.
      return jsonResponse({
        paymentId: 'pay-1', status: 'failed', amount: 1500, currency: 'KZT',
        paidAt: null, failedAt: '2026-08-20T12:00:00.000Z', jobId: 'job-1',
        isTerminal: true, isFailure: true, canRetryPayment: true,
      });
    });

    // Initial render — non-terminal, spinner state.
    await act(async () => {
      render(<PaymentResultPage />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('failedTitle')).not.toBeInTheDocument();

    // Advance past one poll interval (4s) — the failed response now arrives.
    await act(async () => {
      jest.advanceTimersByTime(4000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('failedTitle')).toBeInTheDocument();
    expect(screen.getByText('retryPayment')).toBeInTheDocument();

    const callsAfterFailure = (global.fetch as jest.Mock).mock.calls.length;

    // Advance well past several more poll intervals — no endless spinner, no further polling.
    await act(async () => {
      jest.advanceTimersByTime(30_000);
      await Promise.resolve();
    });

    expect((global.fetch as jest.Mock).mock.calls.length).toBe(callsAfterFailure);
    expect(screen.getByText('failedTitle')).toBeInTheDocument();
  });
});
