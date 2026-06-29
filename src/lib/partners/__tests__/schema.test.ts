import { PartnerApplicationSchema, PARTNER_TYPES } from '../schema';

const validBase = {
  partnerType: 'translator',
  name: 'Иван Петров',
  email: 'ivan@example.com',
};

describe('PartnerApplicationSchema', () => {
  it('accepts a valid minimal payload', () => {
    const result = PartnerApplicationSchema.safeParse(validBase);
    expect(result.success).toBe(true);
  });

  it('accepts a valid full payload', () => {
    const result = PartnerApplicationSchema.safeParse({
      ...validBase,
      phone: '+7 777 123 4567',
      organization: 'ООО Переводы',
      message: 'Готов работать над официальными заказами.',
      refCode: 'PARTNER123',
      utmSource: 'instagram',
      utmMedium: 'social',
      utmCampaign: 'partners-2026',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid partner type', () => {
    const result = PartnerApplicationSchema.safeParse({ ...validBase, partnerType: 'investor' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing name', () => {
    const result = PartnerApplicationSchema.safeParse({ ...validBase, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a name that is too short', () => {
    const result = PartnerApplicationSchema.safeParse({ ...validBase, name: 'A' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email', () => {
    const result = PartnerApplicationSchema.safeParse({ ...validBase, email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing email', () => {
    const result = PartnerApplicationSchema.safeParse({ ...validBase, email: '' });
    expect(result.success).toBe(false);
  });

  it('accepts all defined partner types', () => {
    for (const type of PARTNER_TYPES) {
      const result = PartnerApplicationSchema.safeParse({ ...validBase, partnerType: type });
      expect(result.success).toBe(true);
    }
  });

  it('treats empty optional string as valid', () => {
    const result = PartnerApplicationSchema.safeParse({ ...validBase, phone: '', organization: '' });
    expect(result.success).toBe(true);
  });

  it('rejects a message that exceeds 2000 chars', () => {
    const result = PartnerApplicationSchema.safeParse({
      ...validBase,
      message: 'a'.repeat(2001),
    });
    expect(result.success).toBe(false);
  });
});
