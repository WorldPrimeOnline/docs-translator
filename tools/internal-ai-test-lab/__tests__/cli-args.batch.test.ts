import { parseCliArgs, CliArgError } from '../lib/cli-args';

const batchArgs = [
  '--env-file', 'tools/internal-ai-test-lab/.env.staging.local',
  '--input-dir', './tools/internal-ai-test-lab/input/batch',
  '--manifest', './tools/internal-ai-test-lab/input/batch-manifest.json',
];

describe('parseCliArgs — batch mode detection', () => {
  it('detects batch mode from --input-dir + --manifest', () => {
    const cli = parseCliArgs(batchArgs);
    expect(cli.mode).toBe('batch');
    expect(cli.inputDir).toBe('./tools/internal-ai-test-lab/input/batch');
    expect(cli.manifest).toBe('./tools/internal-ai-test-lab/input/batch-manifest.json');
  });

  it('defaults concurrency to 1 (MVP sequential default)', () => {
    const cli = parseCliArgs(batchArgs);
    expect(cli.concurrency).toBe(1);
  });

  it('defaults continueOnError to true for batch QA (no flags passed)', () => {
    const cli = parseCliArgs(batchArgs);
    expect(cli.continueOnError).toBe(true);
    expect(cli.stopOnError).toBe(false);
  });

  it('--stop-on-error flips continueOnError to false', () => {
    const cli = parseCliArgs([...batchArgs, '--stop-on-error']);
    expect(cli.continueOnError).toBe(false);
    expect(cli.stopOnError).toBe(true);
  });

  it('--continue-on-error is accepted explicitly and matches the default', () => {
    const cli = parseCliArgs([...batchArgs, '--continue-on-error']);
    expect(cli.continueOnError).toBe(true);
  });

  it('rejects passing both --continue-on-error and --stop-on-error', () => {
    expect(() => parseCliArgs([...batchArgs, '--continue-on-error', '--stop-on-error'])).toThrow(CliArgError);
  });

  it('accepts --concurrency 2', () => {
    const cli = parseCliArgs([...batchArgs, '--concurrency', '2']);
    expect(cli.concurrency).toBe(2);
  });

  it('rejects --concurrency above the hard cap of 2', () => {
    expect(() => parseCliArgs([...batchArgs, '--concurrency', '3'])).toThrow(CliArgError);
    try {
      parseCliArgs([...batchArgs, '--concurrency', '5']);
      fail('expected throw');
    } catch (err) {
      expect((err as Error).message).toMatch(/exceeds the maximum of 2/);
      expect((err as Error).message).toMatch(/rate.limit|cost/i);
    }
  });

  it('rejects non-numeric --concurrency', () => {
    expect(() => parseCliArgs([...batchArgs, '--concurrency', 'two'])).toThrow(CliArgError);
  });

  it('rejects zero/negative --concurrency', () => {
    expect(() => parseCliArgs([...batchArgs, '--concurrency', '0'])).toThrow(CliArgError);
  });

  it('parses --limit as a positive integer', () => {
    const cli = parseCliArgs([...batchArgs, '--limit', '2']);
    expect(cli.limit).toBe(2);
  });

  it('rejects non-integer --limit', () => {
    expect(() => parseCliArgs([...batchArgs, '--limit', '2.5'])).toThrow(CliArgError);
  });

  it('parses --only as a raw string (interpretation happens in lib/manifest.ts)', () => {
    const cli = parseCliArgs([...batchArgs, '--only', '01_ru_kk_identity_card_complex.pdf,3']);
    expect(cli.only).toBe('01_ru_kk_identity_card_complex.pdf,3');
  });

  it('parses --skip-existing', () => {
    const cli = parseCliArgs([...batchArgs, '--skip-existing']);
    expect(cli.skipExisting).toBe(true);
  });

  it('defaults skipExisting to false', () => {
    const cli = parseCliArgs(batchArgs);
    expect(cli.skipExisting).toBe(false);
  });

  it('throws when --manifest is missing but --input-dir is present', () => {
    expect(() =>
      parseCliArgs([
        '--env-file', 'x',
        '--input-dir', './tools/internal-ai-test-lab/input/batch',
      ]),
    ).toThrow(CliArgError);
  });

  it('throws when --env-file is missing in batch mode', () => {
    expect(() =>
      parseCliArgs([
        '--input-dir', './tools/internal-ai-test-lab/input/batch',
        '--manifest', './tools/internal-ai-test-lab/input/batch-manifest.json',
      ]),
    ).toThrow(CliArgError);
  });

  it('does not require --file/--source-language/etc in batch mode', () => {
    // Would have thrown "missing required option(s)" listing single-mode flags
    // if batch mode incorrectly inherited single-mode requirements.
    expect(() => parseCliArgs(batchArgs)).not.toThrow();
  });
});

describe('parseCliArgs — --generate-manifest-template mode', () => {
  const templateArgs = [
    '--input-dir', './tools/internal-ai-test-lab/input/batch',
    '--generate-manifest-template',
    '--output-manifest', './tools/internal-ai-test-lab/input/batch-manifest.template.json',
  ];

  it('detects template mode', () => {
    const cli = parseCliArgs(templateArgs);
    expect(cli.mode).toBe('generate-manifest-template');
    expect(cli.inputDir).toBe('./tools/internal-ai-test-lab/input/batch');
    expect(cli.outputManifest).toBe('./tools/internal-ai-test-lab/input/batch-manifest.template.json');
  });

  it('does not require --env-file for template mode', () => {
    expect(() => parseCliArgs(templateArgs)).not.toThrow();
  });

  it('throws when --output-manifest is missing', () => {
    expect(() =>
      parseCliArgs(['--input-dir', './tools/internal-ai-test-lab/input/batch', '--generate-manifest-template']),
    ).toThrow(CliArgError);
  });
});
