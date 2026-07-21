/**
 * --dry-run preview: shows which parameters WOULD be applied to each discovered file, and which
 * layer of the priority chain (lib/config.ts) actually supplied each value — analyzing NOTHING,
 * calculating NOTHING. This module never touches analyzeDocumentForPricing/calculatePrice/
 * buildRussianReport, and produces no FileResult (no success/operator_review/failed status).
 */
import type { PricingParamsInput, ResolvedFileParams } from './types';

export type ParamSource = 'cli' | 'file_manifest' | 'manifest_defaults' | 'config' | 'default';

export interface NamedParamsLayer {
  source: ParamSource;
  values: PricingParamsInput;
}

/** Exactly the 8 fields the dry-run preview reports on. */
const TRACKED_FIELDS = [
  'sourceLanguage',
  'targetLanguage',
  'serviceLevel',
  'applicantType',
  'deliveryRequired',
  'notaryUrgency',
  'channel',
  'partnerCommissionRate',
] as const;

export type TrackedField = (typeof TRACKED_FIELDS)[number];
export type ProvenanceMap = Record<TrackedField, ParamSource>;

/** `layers` must be ordered HIGHEST priority first: cli, file_manifest, manifest_defaults, config, default. */
export function traceProvenance(layers: NamedParamsLayer[]): ProvenanceMap {
  const provenance = {} as ProvenanceMap;
  for (const field of TRACKED_FIELDS) {
    let found: ParamSource = 'default';
    for (const layer of layers) {
      if (layer.values[field] !== undefined) {
        found = layer.source;
        break;
      }
    }
    provenance[field] = found;
  }
  return provenance;
}

export interface DryRunFileInfo {
  filename: string;
  resolved: ResolvedFileParams;
  provenance: ProvenanceMap;
}

const SOURCE_LABEL: Record<ParamSource, string> = {
  cli: 'CLI',
  file_manifest: 'file manifest',
  manifest_defaults: 'manifest defaults',
  config: 'config',
  default: 'default',
};

function fieldValue(resolved: ResolvedFileParams, field: TrackedField): string {
  switch (field) {
    case 'sourceLanguage':
      return resolved.sourceLanguage;
    case 'targetLanguage':
      return resolved.targetLanguage;
    case 'serviceLevel':
      return resolved.serviceLevel;
    case 'applicantType':
      return resolved.applicantType;
    case 'deliveryRequired':
      return String(resolved.deliveryRequired);
    case 'notaryUrgency':
      return resolved.urgency;
    case 'channel':
      return resolved.salesChannel;
    case 'partnerCommissionRate':
      return resolved.partnerCommissionRateOverride != null ? String(resolved.partnerCommissionRateOverride) : '(not set)';
  }
}

export function formatDryRunFileBlock(index: number, total: number, info: DryRunFileInfo): string {
  const lines = [`[${index}/${total}] ${info.filename}`];
  for (const field of TRACKED_FIELDS) {
    const value = fieldValue(info.resolved, field);
    const source = SOURCE_LABEL[info.provenance[field]];
    lines.push(`  ${field.padEnd(22)} ${value.padEnd(45)} (${source})`);
  }
  return lines.join('\n');
}
