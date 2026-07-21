import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfigFile, mergeParamsLayers, InvalidConfigError, SAFE_DEFAULTS } from '../lib/config';
import { loadManifest } from '../lib/manifest';
import { resolveFileParams } from '../lib/params-resolver';

function tmpFile(name: string, content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-cli-test-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content, 'utf-8');
  return file;
}

describe('mergeParamsLayers — priority chain', () => {
  it('later layers override earlier ones', () => {
    const merged = mergeParamsLayers({ sourceLanguage: 'ru' }, { sourceLanguage: 'en' });
    expect(merged.sourceLanguage).toBe('en');
  });

  it('merges versionOverrides key-by-key instead of replacing wholesale', () => {
    const merged = mergeParamsLayers(
      { versionOverrides: { mrpValue: 5, taxRate: 0.1 } },
      { versionOverrides: { mrpValue: 6 } },
    );
    expect(merged.versionOverrides).toEqual({ mrpValue: 6, taxRate: 0.1 });
  });

  it('ignores undefined values so a lower layer is not clobbered', () => {
    const merged = mergeParamsLayers({ sourceLanguage: 'ru' }, { sourceLanguage: undefined });
    expect(merged.sourceLanguage).toBe('ru');
  });

  it('full 5-layer priority: CLI > manifest file > manifest defaults > config > safe defaults', () => {
    const merged = mergeParamsLayers(
      SAFE_DEFAULTS,
      { sourceLanguage: 'kk' }, // config
      { sourceLanguage: 'de' }, // manifest defaults
      { sourceLanguage: 'fr' }, // manifest per-file
      { sourceLanguage: 'th' }, // CLI flags
    );
    expect(merged.sourceLanguage).toBe('th');
  });
});

describe('loadConfigFile', () => {
  it('returns {} when no path is given', () => {
    expect(loadConfigFile(undefined)).toEqual({});
  });

  it('loads and validates a real config file', () => {
    const file = tmpFile('config.json', JSON.stringify({ sourceLanguage: 'ru', targetLanguage: 'en' }));
    expect(loadConfigFile(file)).toEqual({ sourceLanguage: 'ru', targetLanguage: 'en' });
  });

  it('throws InvalidConfigError on unreadable path', () => {
    expect(() => loadConfigFile('/no/such/file.json')).toThrow(InvalidConfigError);
  });

  it('throws InvalidConfigError on invalid JSON', () => {
    const file = tmpFile('bad.json', '{not json');
    expect(() => loadConfigFile(file)).toThrow(InvalidConfigError);
  });

  it('throws InvalidConfigError on an unknown field (strict schema)', () => {
    const file = tmpFile('unknown.json', JSON.stringify({ notAField: 1 }));
    expect(() => loadConfigFile(file)).toThrow(InvalidConfigError);
  });
});

describe('loadManifest', () => {
  it('returns empty defaults/files when the manifest does not exist', () => {
    expect(loadManifest(undefined)).toEqual({ defaults: {}, files: {} });
    expect(loadManifest('/no/such/manifest.json')).toEqual({ defaults: {}, files: {} });
  });

  it('loads defaults and per-file entries', () => {
    const file = tmpFile(
      'manifest.json',
      JSON.stringify({
        defaults: { sourceLanguage: 'ru', targetLanguage: 'en' },
        files: { 'passport.pdf': { targetLanguage: 'de' } },
      }),
    );
    const manifest = loadManifest(file);
    expect(manifest.defaults).toEqual({ sourceLanguage: 'ru', targetLanguage: 'en' });
    expect(manifest.files['passport.pdf']).toEqual({ targetLanguage: 'de' });
  });

  it('throws InvalidConfigError on invalid JSON', () => {
    const file = tmpFile('bad-manifest.json', 'not json');
    expect(() => loadManifest(file)).toThrow(InvalidConfigError);
  });
});

describe('resolveFileParams — aliases + safe defaults', () => {
  it('applies safe defaults when nothing else is provided', () => {
    const params = resolveFileParams({}, 'test');
    expect(params.sourceLanguage).toBe('ru');
    expect(params.targetLanguage).toBe('en');
    expect(params.serviceLevel).toBe('official_with_translator_signature_and_provider_stamp');
    expect(params.applicantType).toBe('individual');
    expect(params.salesChannel).toBe('direct');
    expect(params.urgency).toBe('standard');
  });

  it('resolves the "official"/"notary"/"electronic" service level aliases', () => {
    expect(resolveFileParams({ serviceLevel: 'official' }, 'x').serviceLevel).toBe('official_with_translator_signature_and_provider_stamp');
    expect(resolveFileParams({ serviceLevel: 'notary' }, 'x').serviceLevel).toBe('notarization_through_partners');
    expect(resolveFileParams({ serviceLevel: 'electronic' }, 'x').serviceLevel).toBe('electronic');
  });

  it('throws InvalidConfigError on an unknown serviceLevel', () => {
    expect(() => resolveFileParams({ serviceLevel: 'bogus' }, 'x')).toThrow(InvalidConfigError);
  });

  it('throws InvalidConfigError on an unknown notaryUrgency', () => {
    expect(() => resolveFileParams({ notaryUrgency: 'bogus' }, 'x')).toThrow(InvalidConfigError);
  });

  it('resolves urgency window aliases (before_noon/after_noon/after_18)', () => {
    expect(resolveFileParams({ notaryUrgency: 'after_noon' }, 'x').urgency).toBe('after_noon');
  });
});
