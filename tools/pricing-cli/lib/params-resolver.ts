/**
 * Turns a merged PricingParamsInput (after the full priority chain in lib/config.ts) into a
 * fully-resolved ResolvedFileParams — resolving CLI-friendly aliases (service level, urgency,
 * applicant type, channel) to the project's real canonical enums and filling in safe defaults
 * for anything still missing.
 */
import { InvalidConfigError, SAFE_DEFAULTS } from './config';
import { resolveApplicantType, resolveChannel, resolveServiceLevel, resolveUrgency } from './alias-map';
import type { PricingParamsInput, ResolvedFileParams, UrgencyAlias } from './types';

export function resolveFileParams(merged: PricingParamsInput, context: string): ResolvedFileParams {
  const withDefaults: PricingParamsInput = { ...SAFE_DEFAULTS, ...merged, versionOverrides: { ...merged.versionOverrides } };

  const serviceLevel = resolveServiceLevel(withDefaults.serviceLevel ?? '');
  if (!serviceLevel) {
    throw new InvalidConfigError(`${context}: unknown serviceLevel '${withDefaults.serviceLevel}'. Use one of: electronic, official, notary (or the full canonical enum value).`);
  }

  const urgency: UrgencyAlias | null = resolveUrgency(withDefaults.notaryUrgency ?? 'standard');
  if (!urgency) {
    throw new InvalidConfigError(`${context}: unknown notaryUrgency '${withDefaults.notaryUrgency}'. Use one of: standard, same_day, before_noon, after_noon, after_18.`);
  }

  const applicantType = withDefaults.applicantType ? resolveApplicantType(withDefaults.applicantType) : 'individual';
  if (!applicantType) {
    throw new InvalidConfigError(`${context}: unknown applicantType '${withDefaults.applicantType}'. Use 'individual' or 'legal_entity'.`);
  }

  const channel = withDefaults.channel ? resolveChannel(withDefaults.channel) : 'direct';
  if (!channel) {
    throw new InvalidConfigError(`${context}: unknown channel '${withDefaults.channel}'. Use 'direct' or 'referral'.`);
  }

  if (!withDefaults.sourceLanguage) throw new InvalidConfigError(`${context}: sourceLanguage is required.`);
  if (!withDefaults.targetLanguage) throw new InvalidConfigError(`${context}: targetLanguage is required.`);
  if (!withDefaults.pricingVersionCode) throw new InvalidConfigError(`${context}: pricingVersionCode is required.`);

  const deliveryRequired = withDefaults.deliveryRequired ?? false;

  return {
    pricingVersionCode: withDefaults.pricingVersionCode,
    pricingVersionSource: withDefaults.pricingVersionSource ?? 'local',
    sourceLanguage: withDefaults.sourceLanguage,
    targetLanguage: withDefaults.targetLanguage,
    serviceLevel,
    applicantType,
    // fulfillmentMethod comes from an explicit layer (`merged`, never SAFE_DEFAULTS — see the
    // comment on SAFE_DEFAULTS in config.ts) if set, otherwise it is DERIVED from deliveryRequired
    // so the two can never silently disagree.
    fulfillmentMethod: merged.fulfillmentMethod ?? (deliveryRequired ? 'delivery' : 'pickup'),
    deliveryRequired,
    urgency,
    extraPaperCopies: withDefaults.extraPaperCopies ?? 0,
    salesChannel: channel,
    partnerCommissionRateOverride: withDefaults.partnerCommissionRate,
    manualAdjustmentKzt: withDefaults.manualAdjustmentKzt ?? 0,
    manualAdjustmentReason: withDefaults.manualAdjustmentReason,
    languageRateOverrideKzt: withDefaults.languageRateOverrideKzt,
    manualPhysicalPageCountOverride: withDefaults.manualPhysicalPageCountOverride,
    versionOverrides: withDefaults.versionOverrides ?? {},
  };
}
