import { parseCliArgs, CliArgsError } from '../lib/cli-args';

describe('parseCliArgs', () => {
  it('parses --key value pairs', () => {
    const opts = parseCliArgs(['--input', './docs', '--source', 'ru', '--target', 'en']);
    expect(opts.input).toBe('./docs');
    expect(opts.paramsLayer.sourceLanguage).toBe('ru');
    expect(opts.paramsLayer.targetLanguage).toBe('en');
  });

  it('parses --key=value form', () => {
    const opts = parseCliArgs(['--input=./docs', '--source=ru']);
    expect(opts.input).toBe('./docs');
    expect(opts.paramsLayer.sourceLanguage).toBe('ru');
  });

  it('treats --delivery as a boolean flag setting deliveryRequired + fulfillmentMethod', () => {
    const opts = parseCliArgs(['--input', './docs', '--delivery']);
    expect(opts.paramsLayer.deliveryRequired).toBe(true);
    expect(opts.paramsLayer.fulfillmentMethod).toBe('delivery');
  });

  it('defaults output to ./pricing-results', () => {
    const opts = parseCliArgs(['--input', './docs']);
    expect(opts.output).toBe('./pricing-results');
  });

  it('parses boolean-only flags: --no-ocr --dry-run --no-cache --clear-cache --from-staging', () => {
    const opts = parseCliArgs(['--input', './docs', '--no-ocr', '--dry-run', '--no-cache', '--clear-cache', '--from-staging']);
    expect(opts.noOcr).toBe(true);
    expect(opts.dryRun).toBe(true);
    expect(opts.noCache).toBe(true);
    expect(opts.clearCache).toBe(true);
    expect(opts.fromStaging).toBe(true);
    expect(opts.paramsLayer.pricingVersionSource).toBe('staging');
  });

  it('parses economics override flags into versionOverrides', () => {
    const opts = parseCliArgs(['--input', './docs', '--override-partner-commission-rate', '0.10', '--override-mrp', '5']);
    expect(opts.paramsLayer.versionOverrides).toEqual({ partnerCommissionRate: 0.10, mrpValue: 5 });
  });

  it('rejects a flag requiring a value with none provided', () => {
    expect(() => parseCliArgs(['--input'])).toThrow(CliArgsError);
  });

  it('rejects a non-numeric value for a numeric flag', () => {
    expect(() => parseCliArgs(['--input', './docs', '--partner-rate', 'abc'])).toThrow(CliArgsError);
  });

  it('rejects a bare positional argument', () => {
    expect(() => parseCliArgs(['./docs'])).toThrow(CliArgsError);
  });

  it('--help sets help:true without requiring --input', () => {
    const opts = parseCliArgs(['--help']);
    expect(opts.help).toBe(true);
  });
});
