/**
 * Public-facing minimum ("from") price correction — approved production
 * baseline after the layered notary margin pricing model went live:
 *   electronic 1,500 KZT · official/certified 6,200 KZT ·
 *   notarized pickup 15,000 KZT · notarized + Almaty delivery 21,000 KZT.
 *
 * These are marketing "from" prices (the real final price for the cheapest
 * realistic order under the current pricing engine), NOT the internal
 * BASE_MINIMUM_KZT constants in src/lib/pricing/config.ts (which remain
 * unchanged — this is a UI/i18n copy fix only, see docs in the same PR).
 */
import * as path from 'path';
import * as fs from 'fs';
import { LOCALE_CODES } from '../../i18n/locales';

const MESSAGES_DIR = path.resolve(__dirname, '../../../messages');

function loadMessages(locale: string, ns: string): Record<string, unknown> {
  const filePath = path.join(MESSAGES_DIR, locale, `${ns}.json`);
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as Record<string, unknown>;
}

const OLD_PRICE_PATTERNS = [/5[ ,.]500/, /11[ ,.]000/];

describe('minimum price i18n — no stale pre-correction figures remain', () => {
  for (const locale of LOCALE_CODES) {
    it(`${locale}: pricing.json has no old 5,500 / 11,000 figures`, () => {
      const pricing = JSON.stringify(loadMessages(locale, 'pricing'));
      for (const pattern of OLD_PRICE_PATTERNS) {
        expect(pattern.test(pricing)).toBe(false);
      }
    });

    it(`${locale}: order.json price hints have no old 5,500 / 11,000 figures`, () => {
      const order = loadMessages(locale, 'order') as { dashboard: Record<string, unknown> };
      const hints = JSON.stringify({
        priceHintOfficial: order.dashboard.priceHintOfficial,
        priceHintNotarized: order.dashboard.priceHintNotarized,
      });
      for (const pattern of OLD_PRICE_PATTERNS) {
        expect(pattern.test(hints)).toBe(false);
      }
    });
  }
});

describe('minimum price i18n — official/certified minimum shows 6,200', () => {
  for (const locale of LOCALE_CODES) {
    it(`${locale}: pricing.json agentStampPrice and tiers.agentStamp.price contain 6,200`, () => {
      const pricing = loadMessages(locale, 'pricing') as {
        pricing: { agentStampPrice: string; tiers: { agentStamp: { price: string } } };
      };
      expect(/6[ ,.]200/.test(pricing.pricing.agentStampPrice)).toBe(true);
      expect(/6[ ,.]200/.test(pricing.pricing.tiers.agentStamp.price)).toBe(true);
    });
  }

  it('ru: order.json priceHintOfficial shows 6,200', () => {
    const order = loadMessages('ru', 'order') as { dashboard: { priceHintOfficial: string } };
    expect(order.dashboard.priceHintOfficial).toContain('6 200');
  });
});

describe('minimum price i18n — notarized minimum shows 15,000', () => {
  for (const locale of LOCALE_CODES) {
    it(`${locale}: pricing.json notarizedPrice and tiers.notarized.price contain 15,000`, () => {
      const pricing = loadMessages(locale, 'pricing') as {
        pricing: { notarizedPrice: string; tiers: { notarized: { price: string } } };
      };
      expect(/15[ ,.]000/.test(pricing.pricing.notarizedPrice)).toBe(true);
      expect(/15[ ,.]000/.test(pricing.pricing.tiers.notarized.price)).toBe(true);
    });
  }

  it('ru: order.json priceHintNotarized shows 15,000', () => {
    const order = loadMessages('ru', 'order') as { dashboard: { priceHintNotarized: string } };
    expect(order.dashboard.priceHintNotarized).toContain('15 000');
  });
});

describe('minimum price i18n — Almaty delivery note shows 21,000 where applicable', () => {
  for (const locale of LOCALE_CODES) {
    it(`${locale}: pricing.json notarized tier's 5th feature and priceHintNotarized both mention 21,000`, () => {
      const pricing = loadMessages(locale, 'pricing') as {
        pricing: { notarizedF5: string; tiers: { notarized: { features: string[] } } };
      };
      expect(/21[ ,.]000/.test(pricing.pricing.notarizedF5)).toBe(true);
      const features = pricing.pricing.tiers.notarized.features;
      expect(features.some((f) => /21[ ,.]000/.test(f))).toBe(true);
    });

    it(`${locale}: order.json priceHintNotarized mentions 21,000 (delivery calculated separately)`, () => {
      const order = loadMessages(locale, 'order') as { dashboard: { priceHintNotarized: string } };
      expect(/21[ ,.]000/.test(order.dashboard.priceHintNotarized)).toBe(true);
    });
  }
});

describe('minimum price i18n — upload/service-level cards match landing pages', () => {
  it('ru: dashboard price hints and pricing.json tiers agree on all four figures', () => {
    const order = loadMessages('ru', 'order') as { dashboard: { priceHintElectronic: string; priceHintOfficial: string; priceHintNotarized: string } };
    const pricing = loadMessages('ru', 'pricing') as {
      pricing: { electronicPrice: string; agentStampPrice: string; notarizedPrice: string };
    };
    expect(order.dashboard.priceHintElectronic).toContain('1 500');
    expect(pricing.pricing.electronicPrice).toContain('1 500');
    expect(order.dashboard.priceHintOfficial).toContain('6 200');
    expect(pricing.pricing.agentStampPrice).toContain('6 200');
    expect(order.dashboard.priceHintNotarized).toContain('15 000');
    expect(pricing.pricing.notarizedPrice).toContain('15 000');
  });
});

describe('minimum price i18n — pricing engine constants are untouched by this fix', () => {
  it('BASE_MINIMUM_KZT.ru_kz.official is still the internal 5500 base (not renamed to a UI price)', () => {
    const configSrc = fs.readFileSync(
      path.resolve(__dirname, '../pricing/config.ts'),
      'utf-8',
    );
    expect(configSrc).toContain('official: 5500');
  });
});
