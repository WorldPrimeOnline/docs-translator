/**
 * @jest-environment jsdom
 *
 * Regression tests for the "price-ready card replaces the form, scroll position stays
 * stale" fix (2026-07-30). The price-ready card renders at the same spot in the tree as
 * the (often much taller) form — without an explicit scroll, a user who filled out the
 * form near the bottom sees empty space/footer instead of their price.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { getSession: () => Promise.resolve({ data: { session: null } }) } }),
}));

// Stub OrderForm so this file tests OrderWizard's own scroll/focus behavior in isolation —
// clicking the stub button simulates a real OrderForm calling onDraftPriced() after a
// successful calculate.
jest.mock('@/components/order/OrderForm', () => ({
  OrderForm: (props: { onDraftIdChange?: (id: string) => void; onDraftPriced?: (result: unknown, draftId: string) => void }) => (
    <button
      type="button"
      data-testid="simulate-price-ready"
      onClick={() => {
        props.onDraftIdChange?.('draft-1');
        props.onDraftPriced?.({ priceKzt: 5000, currency: 'KZT', requiresOperatorReview: false }, 'draft-1');
      }}
    >
      simulate form submit
    </button>
  ),
}));

import { OrderWizard } from '../OrderWizard';

function mockMatchMedia(prefersReducedMotion: boolean) {
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? prefersReducedMotion : false,
    media: query,
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe('OrderWizard — price-ready card scroll/focus (2026-07-30)', () => {
  let scrollIntoViewSpy: jest.Mock;
  let focusSpy: jest.SpyInstance;

  beforeEach(() => {
    scrollIntoViewSpy = jest.fn();
    // jsdom does not implement scrollIntoView at all.
    HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy;
    focusSpy = jest.spyOn(HTMLElement.prototype, 'focus');
    mockMatchMedia(false);
  });

  afterEach(() => {
    focusSpy.mockRestore();
  });

  it('does not scroll/focus anything while still showing the form', () => {
    render(<OrderWizard />);
    expect(screen.getByTestId('simulate-price-ready')).toBeInTheDocument();
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it('scrolls the price card into view and focuses its heading exactly once when entering the ready state', () => {
    render(<OrderWizard />);
    fireEvent.click(screen.getByTestId('simulate-price-ready'));

    // The form (bottom of a potentially long page) is gone; the price card is shown.
    expect(screen.queryByTestId('simulate-price-ready')).not.toBeInTheDocument();
    expect(screen.getByText('priceReadyTitle')).toBeInTheDocument();

    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });

    // Focus moved to the heading itself (not window/body), without a second competing scroll.
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    const heading = screen.getByText('priceReadyTitle');
    expect(heading.tabIndex).toBe(-1);
  });

  it('uses instant (not smooth) scrolling when prefers-reduced-motion is enabled', () => {
    mockMatchMedia(true);
    render(<OrderWizard />);
    fireEvent.click(screen.getByTestId('simulate-price-ready'));

    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
  });

  it('never re-fires the scroll/focus effect on an unrelated re-render of the already-ready state', () => {
    const { rerender } = render(<OrderWizard />);
    fireEvent.click(screen.getByTestId('simulate-price-ready'));
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledTimes(1);

    // Simulate an ordinary re-render (e.g. a parent-driven update) — internal `price` state
    // is unchanged, so the effect must not run again.
    rerender(<OrderWizard />);
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it('returning to the form (editDetails) and re-submitting scrolls/focuses again — a genuinely new ready transition', () => {
    render(<OrderWizard />);
    fireEvent.click(screen.getByTestId('simulate-price-ready'));
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('editDetails'));
    expect(screen.getByTestId('simulate-price-ready')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('simulate-price-ready'));
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(2);
    expect(focusSpy).toHaveBeenCalledTimes(2);
  });
});
