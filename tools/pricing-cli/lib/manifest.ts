/**
 * test-documents/manifest.json — optional per-file overrides on top of pricing-test-config.json
 * (see README §Configuration and lib/config.ts for the full 5-layer priority chain).
 */
import * as fs from 'node:fs';
import { z } from 'zod';
import type { PricingParamsInput } from './types';
import { InvalidConfigError, validateParamsLayer } from './config';

export interface Manifest {
  defaults: PricingParamsInput;
  files: Record<string, PricingParamsInput>;
}

const ManifestShapeSchema = z.object({
  defaults: z.record(z.string(), z.unknown()).optional(),
  files: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

/** Returns { defaults: {}, files: {} } if manifestPath is undefined or the file doesn't exist. */
export function loadManifest(manifestPath: string | undefined): Manifest {
  if (!manifestPath || !fs.existsSync(manifestPath)) return { defaults: {}, files: {} };

  let raw: string;
  try {
    raw = fs.readFileSync(manifestPath, 'utf-8');
  } catch (err) {
    throw new InvalidConfigError(`Cannot read manifest '${manifestPath}': ${err instanceof Error ? err.message : String(err)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new InvalidConfigError(`Manifest '${manifestPath}' is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const shape = ManifestShapeSchema.safeParse(parsed);
  if (!shape.success) {
    throw new InvalidConfigError(`Manifest '${manifestPath}' has an invalid shape: ${JSON.stringify(shape.error.flatten().fieldErrors)}`);
  }

  const defaults = validateParamsLayer(shape.data.defaults ?? {}, `Manifest '${manifestPath}' defaults`);
  const files: Record<string, PricingParamsInput> = {};
  for (const [filename, entry] of Object.entries(shape.data.files ?? {})) {
    files[filename] = validateParamsLayer(entry, `Manifest '${manifestPath}' entry for '${filename}'`);
  }

  return { defaults, files };
}
