import * as fs from 'node:fs';
import * as path from 'node:path';
import { traceProvenance, formatDryRunFileBlock, type NamedParamsLayer } from '../lib/dry-run';
import { resolveFileParams } from '../lib/params-resolver';
import { SAFE_DEFAULTS, mergeParamsLayers } from '../lib/config';

describe('traceProvenance', () => {
  it('reports "default" when no layer sets a field', () => {
    const layers: NamedParamsLayer[] = [
      { source: 'cli', values: {} },
      { source: 'file_manifest', values: {} },
      { source: 'manifest_defaults', values: {} },
      { source: 'config', values: {} },
      { source: 'default', values: SAFE_DEFAULTS },
    ];
    const provenance = traceProvenance(layers);
    expect(provenance.sourceLanguage).toBe('default');
    expect(provenance.channel).toBe('default');
  });

  it('picks the highest-priority layer that actually set the field', () => {
    const layers: NamedParamsLayer[] = [
      { source: 'cli', values: { sourceLanguage: 'th' } },
      { source: 'file_manifest', values: { sourceLanguage: 'de', targetLanguage: 'de' } },
      { source: 'manifest_defaults', values: { sourceLanguage: 'kk', targetLanguage: 'kk', serviceLevel: 'electronic' } },
      { source: 'config', values: { sourceLanguage: 'ru', targetLanguage: 'ru', serviceLevel: 'official', applicantType: 'legal_entity' } },
      { source: 'default', values: SAFE_DEFAULTS },
    ];
    const provenance = traceProvenance(layers);
    expect(provenance.sourceLanguage).toBe('cli'); // cli set it
    expect(provenance.targetLanguage).toBe('file_manifest'); // cli did not set it
    expect(provenance.serviceLevel).toBe('manifest_defaults'); // cli/file_manifest did not set it
    expect(provenance.applicantType).toBe('config'); // only config set it
    expect(provenance.channel).toBe('default'); // nothing set it
  });
});

describe('formatDryRunFileBlock', () => {
  it('includes all 8 required fields and their source labels, never a status word', () => {
    const resolved = resolveFileParams({}, 'test');
    const layers: NamedParamsLayer[] = [
      { source: 'cli', values: {} },
      { source: 'file_manifest', values: {} },
      { source: 'manifest_defaults', values: {} },
      { source: 'config', values: {} },
      { source: 'default', values: SAFE_DEFAULTS },
    ];
    const block = formatDryRunFileBlock(1, 10, { filename: 'passport.pdf', resolved, provenance: traceProvenance(layers) });

    expect(block).toContain('passport.pdf');
    expect(block).toContain('sourceLanguage');
    expect(block).toContain('targetLanguage');
    expect(block).toContain('serviceLevel');
    expect(block).toContain('applicantType');
    expect(block).toContain('deliveryRequired');
    expect(block).toContain('notaryUrgency');
    expect(block).toContain('channel');
    expect(block).toContain('partnerCommissionRate');
    expect(block).toContain('(default)');

    expect(block).not.toMatch(/\bSUCCESS\b/);
    expect(block).not.toMatch(/\bOPERATOR_REVIEW\b/i);
    expect(block).not.toMatch(/\bFAILED\b/);
  });

  it('shows "(not set)" for an unset optional field like partnerCommissionRate', () => {
    const resolved = resolveFileParams({}, 'test');
    const layers: NamedParamsLayer[] = [{ source: 'default', values: SAFE_DEFAULTS }];
    const block = formatDryRunFileBlock(1, 1, { filename: 'x.pdf', resolved, provenance: traceProvenance(layers) });
    expect(block).toContain('(not set)');
  });

  it('shows an explicit partnerCommissionRate value when the manifest/config sets one', () => {
    const merged = mergeParamsLayers(SAFE_DEFAULTS, { partnerCommissionRate: 0.1 });
    const resolved = resolveFileParams(merged, 'test');
    const layers: NamedParamsLayer[] = [
      { source: 'config', values: { partnerCommissionRate: 0.1 } },
      { source: 'default', values: SAFE_DEFAULTS },
    ];
    const block = formatDryRunFileBlock(1, 1, { filename: 'x.pdf', resolved, provenance: traceProvenance(layers) });
    expect(block).toContain('0.1');
    expect(block).toContain('(config)');
  });
});

describe('index.ts — --dry-run branch never touches the pricing pipeline (static check)', () => {
  const INDEX_SRC = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf-8');

  function extractDryRunBlock(): string {
    const start = INDEX_SRC.indexOf('if (options.dryRun) {');
    expect(start).toBeGreaterThan(-1);
    // The dry-run branch is closed by the first `process.exit(0);` that follows it, plus its
    // closing brace — slice generously to the next top-level statement after that exit call.
    const exitPos = INDEX_SRC.indexOf('process.exit(0);', start);
    expect(exitPos).toBeGreaterThan(-1);
    return INDEX_SRC.slice(start, exitPos + 'process.exit(0);'.length);
  }

  it('never calls runPricingForFile, analyzeLocalFile, calculatePrice, or buildRussianReport', () => {
    const block = extractDryRunBlock();
    expect(block).not.toContain('runPricingForFile(');
    expect(block).not.toContain('analyzeLocalFile(');
    expect(block).not.toContain('calculatePrice(');
    expect(block).not.toContain('buildRussianReport(');
  });

  it('never writes a per-file report or creates the output/run directory', () => {
    const block = extractDryRunBlock();
    expect(block).not.toContain('.report.json');
    expect(block).not.toContain('.report.md');
    expect(block).not.toContain('ensureDir(');
    expect(block).not.toContain('buildRunDir(');
    expect(block).not.toContain('writeFileSync');
  });

  it('never builds or writes a financial summary (summary.csv/json/md)', () => {
    const block = extractDryRunBlock();
    expect(block).not.toContain('buildSummaryCsv(');
    expect(block).not.toContain('buildSummaryJson(');
    expect(block).not.toContain('buildSummaryMarkdown(');
  });

  it('exits 0 and never assigns a FileResult status', () => {
    const block = extractDryRunBlock();
    expect(block).toContain('process.exit(0)');
    expect(block).not.toMatch(/status:\s*['"](success|operator_review|failed)['"]/);
  });

  it('the dry-run branch runs before the report/summary machinery is created', () => {
    const dryRunPos = INDEX_SRC.indexOf('if (options.dryRun) {');
    const runDirPos = INDEX_SRC.indexOf('const runDir = buildRunDir(');
    expect(dryRunPos).toBeLessThan(runDirPos);
  });
});
