/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://staging.example.vercel.app/"}
 *
 * Split from yandex-metrica.test.ts solely because jsdom 26 makes window.location
 * non-reconfigurable per-test — the jsdom environment's URL can only be set once per
 * file (docblock), so this one dimension (non-production hostname) needs its own file.
 * Covers the hostname half of the "production-only" gate — see also
 * src/components/analytics/YandexMetrica.tsx's inline hostname check for the same
 * gate applied to the counter-init script itself.
 */
import { trackUploadCompleted, trackPageview } from '../yandex-metrica';

const ORIGINAL_ENV = process.env;

function setYm(): jest.Mock {
  const ym = jest.fn();
  (window as unknown as { ym?: unknown }).ym = ym;
  return ym;
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, NEXT_PUBLIC_YANDEX_METRICA_ID: '111762122' };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe('hostname gate — non-production host never fires, even with a valid counter id', () => {
  it('reachGoal-based events do nothing', () => {
    const ym = setYm();
    trackUploadCompleted();
    expect(ym).not.toHaveBeenCalled();
  });

  it('pageview hits do nothing', () => {
    const ym = setYm();
    trackPageview('/ru/dashboard');
    expect(ym).not.toHaveBeenCalled();
  });
});
