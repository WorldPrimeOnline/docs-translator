import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  loadEnvChain,
  checkStagingEnvOrThrow,
  checkOcrEnvOrThrow,
  MissingStagingEnvError,
  MissingOcrEnvError,
  REQUIRED_STAGING_ENV_VARS,
  REQUIRED_OCR_ENV_VARS,
} from '../lib/env-loader';
import { InvalidConfigError } from '../lib/config';

const ENV_KEYS_TO_SNAPSHOT = [...REQUIRED_STAGING_ENV_VARS, ...REQUIRED_OCR_ENV_VARS, 'PRICING_CLI_TEST_VAR', 'NODE_ENV'];

describe('env-loader', () => {
  const originalEnv: Record<string, string | undefined> = {};
  const originalCwd = process.cwd();

  beforeEach(() => {
    for (const key of ENV_KEYS_TO_SNAPSHOT) originalEnv[key] = process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS_TO_SNAPSHOT) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
    process.chdir(originalCwd);
  });

  describe('checkStagingEnvOrThrow', () => {
    it('throws MissingStagingEnvError naming exactly the missing vars, never a value', () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      let caught: unknown;
      try {
        checkStagingEnvOrThrow();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(MissingStagingEnvError);
      const err = caught as MissingStagingEnvError;
      expect(err.missingVars).toEqual(['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
      expect(err.message).toBe(
        'Missing environment variables required for --from-staging: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY',
      );
    });

    it('does not throw when both vars are present', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'a-real-looking-secret-value';
      expect(() => checkStagingEnvOrThrow()).not.toThrow();
    });

    it('reports only the ONE missing var by name when the other is set, and never leaks the set value', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;
      let caught: unknown;
      try {
        checkStagingEnvOrThrow();
      } catch (err) {
        caught = err;
      }
      const err = caught as MissingStagingEnvError;
      expect(err.missingVars).toEqual(['SUPABASE_SERVICE_ROLE_KEY']);
      expect(err.message).not.toContain('https://example.supabase.co');
    });

    it('treats an empty-string value as missing', () => {
      process.env.NEXT_PUBLIC_SUPABASE_URL = '   ';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'real-value';
      expect(() => checkStagingEnvOrThrow()).toThrow(MissingStagingEnvError);
    });
  });

  describe('checkOcrEnvOrThrow', () => {
    it('requires exactly MISTRAL_API_KEY — nothing else', () => {
      expect(REQUIRED_OCR_ENV_VARS).toEqual(['MISTRAL_API_KEY']);
    });

    it('throws MissingOcrEnvError naming only MISTRAL_API_KEY when it is absent', () => {
      delete process.env.MISTRAL_API_KEY;
      let caught: unknown;
      try {
        checkOcrEnvOrThrow();
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(MissingOcrEnvError);
      const err = caught as MissingOcrEnvError;
      expect(err.missingVars).toEqual(['MISTRAL_API_KEY']);
      expect(err.message).toBe('Missing environment variables required for OCR: MISTRAL_API_KEY');
    });

    it('does not throw when MISTRAL_API_KEY is present, regardless of NODE_ENV', () => {
      process.env.MISTRAL_API_KEY = 'real-looking-key';
      delete process.env.NODE_ENV;
      expect(() => checkOcrEnvOrThrow()).not.toThrow();

      process.env.NODE_ENV = 'staging'; // invalid for @/lib/env's schema — must not matter here
      expect(() => checkOcrEnvOrThrow()).not.toThrow();
    });

    it('never mentions R2/Anthropic/Supabase-anon — those are not required for CLI OCR', () => {
      delete process.env.MISTRAL_API_KEY;
      let caught: unknown;
      try {
        checkOcrEnvOrThrow();
      } catch (err) {
        caught = err;
      }
      const err = caught as MissingOcrEnvError;
      for (const forbidden of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'ANTHROPIC_API_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NODE_ENV']) {
        expect(err.missingVars).not.toContain(forbidden);
        expect(err.message).not.toContain(forbidden);
      }
    });
  });

  describe('loadEnvChain', () => {
    it('loads --env-file into process.env', () => {
      delete process.env.PRICING_CLI_TEST_VAR;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-cli-env-'));
      const envFile = path.join(dir, 'custom.env');
      fs.writeFileSync(envFile, 'PRICING_CLI_TEST_VAR=from-env-file\n');

      loadEnvChain(envFile, { fromStaging: false, ocrEnabled: false });
      expect(process.env.PRICING_CLI_TEST_VAR).toBe('from-env-file');
    });

    it('process.env (already set) takes priority over --env-file', () => {
      process.env.PRICING_CLI_TEST_VAR = 'from-shell';
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-cli-env-'));
      const envFile = path.join(dir, 'custom.env');
      fs.writeFileSync(envFile, 'PRICING_CLI_TEST_VAR=from-env-file\n');

      loadEnvChain(envFile, { fromStaging: false, ocrEnabled: false });
      expect(process.env.PRICING_CLI_TEST_VAR).toBe('from-shell');
    });

    it('throws InvalidConfigError when --env-file does not exist', () => {
      expect(() => loadEnvChain('/no/such/env/file', { fromStaging: false, ocrEnabled: false })).toThrow(InvalidConfigError);
    });

    it('reports which files were actually loaded (for the startup banner)', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pricing-cli-env-'));
      const envFile = path.join(dir, 'custom.env');
      fs.writeFileSync(envFile, 'PRICING_CLI_TEST_VAR=x\n');

      const result = loadEnvChain(envFile, { fromStaging: false, ocrEnabled: false });
      expect(result.loadedFiles).toContain(envFile);
    });

    it('does not attempt to load .env.staging.local when neither --from-staging nor OCR is enabled', () => {
      // No assertion on file contents needed — this just proves it doesn't throw or require
      // tools/pricing-cli/.env.staging.local to exist when neither mode is requested.
      expect(() => loadEnvChain(undefined, { fromStaging: false, ocrEnabled: false })).not.toThrow();
    });
  });
});
