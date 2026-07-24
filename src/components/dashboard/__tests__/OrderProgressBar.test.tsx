/**
 * @jest-environment jsdom
 *
 * 2026-07-24 visual simplification: the dashboard's active-order progress display
 * used to render a thin bar, a full milestone-dot track (one dot per stage — done/
 * current/future), and then repeat the current status text (plus percent) again
 * below the dots — "looks broken and cluttered" per the report. This locks in the
 * replacement: exactly one continuous bar, with a single status+percent line above
 * it and nothing repeated below. Purely presentational — statusLabel/percent are
 * passed in as plain props, computed upstream by resolveCustomerProgressFlow via
 * getCustomerOrderState; this component/test never touches that resolver.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { OrderProgressBar, shouldShowOrderProgressBar } from '../OrderProgressBar';

describe('OrderProgressBar — no milestone dots, exactly one bar', () => {
  it('renders no elements with a `title` attribute (the old per-stage markers were the only thing in this component ever using `title`)', () => {
    const { container } = render(<OrderProgressBar statusLabel="Передано переводчику — ожидает проверки" percent={35} />);
    expect(container.querySelectorAll('[title]')).toHaveLength(0);
  });

  it('renders no absolutely-positioned marker elements (the old dots\' distinguishing class)', () => {
    const { container } = render(<OrderProgressBar statusLabel="status" percent={35} />);
    expect(container.getElementsByClassName('-translate-x-1/2')).toHaveLength(0);
  });

  it('renders exactly one progress track and one fill', () => {
    const { container } = render(<OrderProgressBar statusLabel="status" percent={35} />);
    expect(container.querySelectorAll('[data-testid="order-progress-track"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-testid="order-progress-fill"]')).toHaveLength(1);
  });
});

describe('OrderProgressBar — status and percent each render exactly once', () => {
  it('the status label appears exactly once', () => {
    render(<OrderProgressBar statusLabel="Передано переводчику — ожидает проверки" percent={35} />);
    expect(screen.getAllByText('Передано переводчику — ожидает проверки')).toHaveLength(1);
  });

  it('the percent appears exactly once, and only as the percent (never duplicated in a second line below the bar)', () => {
    const { container } = render(<OrderProgressBar statusLabel="status" percent={35} />);
    expect(screen.getAllByText('35%')).toHaveLength(1);
    // The fill's own inline width is a style, not text content, so this stays 1.
    expect(container.querySelectorAll('[data-testid="order-progress-percent"]')).toHaveLength(1);
  });

  it('status is on the left, percent is on the right, within one line above the bar', () => {
    const { container } = render(<OrderProgressBar statusLabel="status text" percent={35} />);
    const line = screen.getByText('status text').parentElement!;
    expect(line).toContainElement(screen.getByTestId('order-progress-percent'));
    const children = Array.from(line.children);
    expect(children[0]).toHaveTextContent('status text');
    expect(children[children.length - 1]).toHaveTextContent('35%');
    // The line comes before the track in DOM order (i.e. above the bar).
    const track = container.querySelector('[data-testid="order-progress-track"]')!;
    expect(line.compareDocumentPosition(track) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('OrderProgressBar — fill width equals percent exactly', () => {
  it.each([35, 50, 90, 96, 100])('percent=%d -> fill width is "%d%%"', (percent) => {
    render(<OrderProgressBar statusLabel="status" percent={percent} />);
    const fill = screen.getByTestId('order-progress-fill');
    expect(fill.style.width).toBe(`${percent}%`);
  });
});

describe('shouldShowOrderProgressBar — pre-payment gating (unchanged from resolveCustomerProgressFlow\'s existing contract)', () => {
  it('false before payment (showFulfillmentProgress=false), regardless of percent', () => {
    expect(shouldShowOrderProgressBar(false, null)).toBe(false);
    expect(shouldShowOrderProgressBar(false, 0)).toBe(false);
    expect(shouldShowOrderProgressBar(false, 50)).toBe(false);
  });

  it('false when showFulfillmentProgress is true but percent is not yet known (null)', () => {
    expect(shouldShowOrderProgressBar(true, null)).toBe(false);
  });

  it('true once payment is confirmed and a real percent exists, including 0', () => {
    expect(shouldShowOrderProgressBar(true, 0)).toBe(true);
    expect(shouldShowOrderProgressBar(true, 35)).toBe(true);
    expect(shouldShowOrderProgressBar(true, 100)).toBe(true);
  });
});
