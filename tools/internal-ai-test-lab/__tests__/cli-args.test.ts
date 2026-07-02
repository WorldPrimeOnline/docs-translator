import { parseCliArgs, CliArgError } from '../lib/cli-args';

describe('parseCliArgs', () => {
  const baseArgs = [
    '--env-file', 'tools/internal-ai-test-lab/.env.staging.local',
    '--file', './input/passport.pdf',
    '--source-language', 'RU',
    '--target-language', 'EN',
    '--document-type', 'passport',
    '--service-level', 'official_translation',
  ];

  it('parses all required options', () => {
    const cli = parseCliArgs(baseArgs);
    expect(cli.envFile).toBe('tools/internal-ai-test-lab/.env.staging.local');
    expect(cli.file).toBe('./input/passport.pdf');
    expect(cli.sourceLanguage).toBe('ru');
    expect(cli.targetLanguage).toBe('en');
    expect(cli.documentTypeRaw).toBe('passport');
    expect(cli.serviceLevelRaw).toBe('official_translation');
  });

  it('applies defaults for optional flags', () => {
    const cli = parseCliArgs(baseArgs);
    expect(cli.outputDir).toBe('tools/internal-ai-test-lab/runs');
    expect(cli.saveToR2).toBe(false);
    expect(cli.dryRunPricingOnly).toBe(false);
    expect(cli.skipRender).toBe(false);
    expect(cli.keepIntermediate).toBe(false);
    expect(cli.debug).toBe(false);
    expect(cli.confirmProduction).toBe(false);
  });

  it('parses boolean flags without a following value', () => {
    const cli = parseCliArgs([...baseArgs, '--save-to-r2', '--confirm-production']);
    expect(cli.saveToR2).toBe(true);
    expect(cli.confirmProduction).toBe(true);
  });

  it('parses optional value flags', () => {
    const cli = parseCliArgs([...baseArgs, '--urgency', 'within_24h', '--notary-city', 'Almaty', '--output-dir', 'custom/out']);
    expect(cli.urgencyRaw).toBe('within_24h');
    expect(cli.notaryCity).toBe('Almaty');
    expect(cli.outputDir).toBe('custom/out');
  });

  it('throws on missing required options', () => {
    expect(() => parseCliArgs(['--env-file', 'x'])).toThrow(CliArgError);
  });

  it('lists every missing required flag in the error message', () => {
    try {
      parseCliArgs(['--env-file', 'x', '--file', 'y']);
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CliArgError);
      const message = (err as Error).message;
      expect(message).toContain('--source-language');
      expect(message).toContain('--target-language');
      expect(message).toContain('--document-type');
      expect(message).toContain('--service-level');
    }
  });

  it('rejects unknown flags', () => {
    expect(() => parseCliArgs([...baseArgs, '--not-a-real-flag', 'x'])).toThrow(CliArgError);
  });

  it('rejects positional arguments', () => {
    expect(() => parseCliArgs(['positional', ...baseArgs])).toThrow(CliArgError);
  });
});
