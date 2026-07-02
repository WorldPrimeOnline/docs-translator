import {
  mapServiceLevel,
  mapDocumentType,
  mapUrgencyLevel,
  mapFulfillmentMethod,
  inferDeliveryZone,
  AliasMapError,
} from '../lib/alias-map';

describe('mapServiceLevel', () => {
  it('maps canonical CLI example alias "official_translation"', () => {
    expect(mapServiceLevel('official_translation')).toBe('official_with_translator_signature_and_provider_stamp');
  });

  it('passes through already-canonical values', () => {
    expect(mapServiceLevel('electronic')).toBe('electronic');
    expect(mapServiceLevel('notarization_through_partners')).toBe('notarization_through_partners');
  });

  it('is case-insensitive', () => {
    expect(mapServiceLevel('ELECTRONIC')).toBe('electronic');
  });

  it('throws AliasMapError for unknown values', () => {
    expect(() => mapServiceLevel('made_up_level')).toThrow(AliasMapError);
  });
});

describe('mapDocumentType', () => {
  it('maps CLI example alias "passport" to canonical "passport_id"', () => {
    expect(mapDocumentType('passport')).toBe('passport_id');
  });

  it('falls back to "other" for aliases with no dedicated canonical member', () => {
    expect(mapDocumentType('birth_certificate')).toBe('other');
    expect(mapDocumentType('marriage_certificate')).toBe('other');
  });

  it('throws AliasMapError for unknown values', () => {
    expect(() => mapDocumentType('not_a_real_doc_type')).toThrow(AliasMapError);
  });
});

describe('mapUrgencyLevel', () => {
  it('defaults to standard when not provided', () => {
    expect(mapUrgencyLevel(undefined)).toBe('standard');
  });

  it('maps aliases', () => {
    expect(mapUrgencyLevel('24h')).toBe('within_24h');
    expect(mapUrgencyLevel('express')).toBe('six_to_twelve_hours');
    expect(mapUrgencyLevel('rush')).toBe('two_to_four_hours');
  });

  it('throws on unknown urgency', () => {
    expect(() => mapUrgencyLevel('yesterday')).toThrow(AliasMapError);
  });
});

describe('mapFulfillmentMethod', () => {
  it('returns undefined when not provided', () => {
    expect(mapFulfillmentMethod(undefined)).toBeUndefined();
  });

  it('accepts pickup/delivery', () => {
    expect(mapFulfillmentMethod('pickup')).toBe('pickup');
    expect(mapFulfillmentMethod('delivery')).toBe('delivery');
  });

  it('throws on unknown method', () => {
    expect(() => mapFulfillmentMethod('teleport')).toThrow(AliasMapError);
  });
});

describe('inferDeliveryZone', () => {
  it('returns undefined when no city given', () => {
    expect(inferDeliveryZone(undefined)).toBeUndefined();
  });

  it('maps Almaty to almaty_standard', () => {
    expect(inferDeliveryZone('Almaty')).toBe('almaty_standard');
  });

  it('maps any other city to other_city', () => {
    expect(inferDeliveryZone('Astana')).toBe('other_city');
  });
});
