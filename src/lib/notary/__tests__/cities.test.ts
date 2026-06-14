/**
 * @jest-environment node
 */
import { NOTARY_CITIES, isValidNotaryCity, getNotaryCityLabel } from '../cities';

describe('NOTARY_CITIES', () => {
  it('contains at least one city (Almaty)', () => {
    expect(NOTARY_CITIES.length).toBeGreaterThan(0);
    const almaty = NOTARY_CITIES.find((c) => c.value === 'almaty');
    expect(almaty).toBeDefined();
  });
});

describe('isValidNotaryCity', () => {
  it('returns true for almaty', () => {
    expect(isValidNotaryCity('almaty')).toBe(true);
  });

  it('returns false for unknown city', () => {
    expect(isValidNotaryCity('vladivostok')).toBe(false);
  });

  it('is case-sensitive', () => {
    expect(isValidNotaryCity('Almaty')).toBe(false);
  });
});

describe('getNotaryCityLabel', () => {
  it('returns Russian label for ru locale', () => {
    expect(getNotaryCityLabel('almaty', 'ru')).toBe('Алматы');
  });

  it('returns English label for en locale', () => {
    expect(getNotaryCityLabel('almaty', 'en')).toBe('Almaty');
  });

  it('falls back to value for unknown city', () => {
    expect(getNotaryCityLabel('unknown-city', 'en')).toBe('unknown-city');
  });

  it('falls back to en for unknown locale', () => {
    expect(getNotaryCityLabel('almaty', 'xx')).toBe('Almaty');
  });
});
