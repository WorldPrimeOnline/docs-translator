import { extractReferralParams } from '../capture';

describe('extractReferralParams', () => {
  it('returns null when no relevant params are present', () => {
    expect(extractReferralParams('')).toBeNull();
    expect(extractReferralParams('?foo=bar')).toBeNull();
  });

  it('captures ref param', () => {
    const result = extractReferralParams('?ref=PARTNER123');
    expect(result).not.toBeNull();
    expect(result?.refCode).toBe('PARTNER123');
    expect(result?.utmSource).toBeNull();
  });

  it('captures all UTM params', () => {
    const result = extractReferralParams(
      '?utm_source=instagram&utm_medium=social&utm_campaign=partners-2026&utm_content=bio&utm_term=translation',
    );
    expect(result).not.toBeNull();
    expect(result?.utmSource).toBe('instagram');
    expect(result?.utmMedium).toBe('social');
    expect(result?.utmCampaign).toBe('partners-2026');
    expect(result?.utmContent).toBe('bio');
    expect(result?.utmTerm).toBe('translation');
    expect(result?.refCode).toBeNull();
  });

  it('captures ref and UTM together', () => {
    const result = extractReferralParams('?ref=MYCODE&utm_source=email&utm_medium=newsletter');
    expect(result?.refCode).toBe('MYCODE');
    expect(result?.utmSource).toBe('email');
    expect(result?.utmMedium).toBe('newsletter');
  });

  it('returns null when only unrelated params are present', () => {
    expect(extractReferralParams('?page=2&sort=date')).toBeNull();
  });

  it('handles URL-encoded values', () => {
    const result = extractReferralParams('?ref=PARTNER%20123&utm_campaign=test%20campaign');
    expect(result?.refCode).toBe('PARTNER 123');
    expect(result?.utmCampaign).toBe('test campaign');
  });
});
