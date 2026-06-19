import { mapLocaleToHalyk } from '../locale';

describe('mapLocaleToHalyk', () => {
  it('maps ru to rus', () => expect(mapLocaleToHalyk('ru')).toBe('rus'));
  it('maps kk to kaz', () => expect(mapLocaleToHalyk('kk')).toBe('kaz'));
  it('maps kz to kaz', () => expect(mapLocaleToHalyk('kz')).toBe('kaz'));
  it('maps en to eng', () => expect(mapLocaleToHalyk('en')).toBe('eng'));
  it('maps tj to rus', () => expect(mapLocaleToHalyk('tj')).toBe('rus'));
  it('maps uz to rus', () => expect(mapLocaleToHalyk('uz')).toBe('rus'));
  it('maps tk to rus', () => expect(mapLocaleToHalyk('tk')).toBe('rus'));
  it('maps ky to rus', () => expect(mapLocaleToHalyk('ky')).toBe('rus'));
  it('maps mn to rus', () => expect(mapLocaleToHalyk('mn')).toBe('rus'));
  it('maps zh to eng (fallback)', () => expect(mapLocaleToHalyk('zh')).toBe('eng'));
  it('maps ko to eng (fallback)', () => expect(mapLocaleToHalyk('ko')).toBe('eng'));
  it('maps unknown to eng', () => expect(mapLocaleToHalyk('xx')).toBe('eng'));
  it('is case-insensitive', () => expect(mapLocaleToHalyk('RU')).toBe('rus'));
});
