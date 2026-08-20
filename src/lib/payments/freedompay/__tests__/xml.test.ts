import { parseFreedomPayXml, buildFreedomPayResponseXml } from '../xml';

describe('parseFreedomPayXml', () => {
  it('parses a successful response wrapped in a <response> root', () => {
    const xml = '<response><pg_status>ok</pg_status><pg_redirect_url>https://pay.example/x</pg_redirect_url></response>';
    expect(parseFreedomPayXml(xml)).toEqual({
      pg_status: 'ok',
      pg_redirect_url: 'https://pay.example/x',
    });
  });

  it('parses an error response', () => {
    const xml = '<response><pg_status>error</pg_status><pg_error_description>Invalid signature</pg_error_description></response>';
    const parsed = parseFreedomPayXml(xml);
    expect(parsed.pg_status).toBe('error');
    expect(parsed.pg_error_description).toBe('Invalid signature');
  });

  it('throws on genuinely malformed XML', () => {
    expect(() => parseFreedomPayXml('<response><pg_status>ok</response>')).toThrow();
  });

  it('returns an empty object for a response with no fields', () => {
    expect(parseFreedomPayXml('<response></response>')).toEqual({});
  });

  it('coerces numeric-looking values to strings', () => {
    const xml = '<response><pg_amount>1500</pg_amount></response>';
    const parsed = parseFreedomPayXml(xml);
    expect(parsed.pg_amount).toBe('1500');
    expect(typeof parsed.pg_amount).toBe('string');
  });
});

describe('buildFreedomPayResponseXml', () => {
  it('builds a <response> root containing all given fields', () => {
    const xml = buildFreedomPayResponseXml({
      pg_status: 'ok',
      pg_description: 'Order paid',
      pg_salt: 'abc123',
      pg_sig: 'deadbeef',
    });
    expect(xml).toContain('<response>');
    expect(xml).toContain('<pg_status>ok</pg_status>');
    expect(xml).toContain('<pg_description>Order paid</pg_description>');
    expect(xml).toContain('<pg_salt>abc123</pg_salt>');
    expect(xml).toContain('<pg_sig>deadbeef</pg_sig>');
    expect(xml).toContain('</response>');
  });

  it('includes an XML declaration', () => {
    const xml = buildFreedomPayResponseXml({ pg_status: 'ok' });
    expect(xml.startsWith('<?xml')).toBe(true);
  });

  it('round-trips through parseFreedomPayXml', () => {
    const fields = { pg_status: 'ok', pg_description: 'Order paid', pg_salt: 'xyz', pg_sig: 'sig123' };
    const xml = buildFreedomPayResponseXml(fields);
    expect(parseFreedomPayXml(xml)).toEqual(fields);
  });
});
