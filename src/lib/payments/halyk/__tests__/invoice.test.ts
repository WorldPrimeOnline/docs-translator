import { generateInvoiceId, getInvoiceSuffix6, validateInvoiceId, generateUniqueInvoiceId } from '../invoice';

describe('generateInvoiceId', () => {
  it('returns a string of exactly 15 digits', () => {
    for (let i = 0; i < 20; i++) {
      const id = generateInvoiceId();
      expect(typeof id).toBe('string');
      expect(id).toMatch(/^\d{15}$/);
    }
  });

  it('is in the valid 6-15 digit range', () => {
    for (let i = 0; i < 20; i++) {
      expect(validateInvoiceId(generateInvoiceId())).toBe(true);
    }
  });

  it('generates distinct values', () => {
    const ids = new Set(Array.from({ length: 100 }, generateInvoiceId));
    expect(ids.size).toBeGreaterThan(95);
  });

  it('does not use Math.random (crypto-based)', () => {
    const spy = jest.spyOn(Math, 'random');
    generateInvoiceId();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('getInvoiceSuffix6', () => {
  it('returns last 6 characters of the invoice ID', () => {
    expect(getInvoiceSuffix6('123456789012345')).toBe('012345');
    expect(getInvoiceSuffix6('100000000000001')).toBe('000001');
  });
});

describe('validateInvoiceId', () => {
  it('accepts valid 6-15 digit strings', () => {
    expect(validateInvoiceId('123456')).toBe(true);
    expect(validateInvoiceId('123456789012345')).toBe(true);
    expect(validateInvoiceId('100000000000000')).toBe(true);
  });

  it('rejects fewer than 6 digits', () => {
    expect(validateInvoiceId('12345')).toBe(false);
    expect(validateInvoiceId('')).toBe(false);
  });

  it('rejects more than 15 digits', () => {
    expect(validateInvoiceId('1234567890123456')).toBe(false);
  });

  it('rejects non-digit characters', () => {
    expect(validateInvoiceId('123456789abc23')).toBe(false);
    expect(validateInvoiceId('123456-7890123')).toBe(false);
  });
});

describe('generateUniqueInvoiceId', () => {
  it('returns an ID when isFree returns true immediately', async () => {
    const isFree = jest.fn().mockResolvedValue(true);
    const id = await generateUniqueInvoiceId(isFree);
    expect(validateInvoiceId(id)).toBe(true);
    expect(isFree).toHaveBeenCalledTimes(1);
  });

  it('retries until a free ID is found', async () => {
    let calls = 0;
    const isFree = jest.fn().mockImplementation(async () => {
      calls++;
      return calls >= 3;
    });
    const id = await generateUniqueInvoiceId(isFree);
    expect(validateInvoiceId(id)).toBe(true);
    expect(isFree).toHaveBeenCalledTimes(3);
  });

  it('throws after max attempts', async () => {
    const isFree = jest.fn().mockResolvedValue(false);
    await expect(generateUniqueInvoiceId(isFree)).rejects.toThrow();
  });
});
