import { isNotaryDeliveryValid, isDeliverySelected, isFilledIn, type NotaryDeliveryFormState } from '../notary-delivery-validation';

function baseState(overrides: Partial<NotaryDeliveryFormState> = {}): NotaryDeliveryFormState {
  return {
    isNotarization: true,
    notaryCity: 'almaty',
    fulfillmentMethod: 'delivery',
    deliveryPhone: '+7 707 123 45 67',
    deliveryAddress: 'Казыбек Би 10, кв. 25',
    applicantType: 'individual',
    ...overrides,
  };
}

describe('isFilledIn', () => {
  it('rejects empty and whitespace-only strings', () => {
    expect(isFilledIn('')).toBe(false);
    expect(isFilledIn('   ')).toBe(false);
    expect(isFilledIn('\n\t')).toBe(false);
  });

  it('accepts any non-whitespace free text', () => {
    expect(isFilledIn('Казыбек Би 10, кв. 25')).toBe(true);
    expect(isFilledIn('ул. Абая, дом 12, офис 4')).toBe(true);
    expect(isFilledIn('Алматы, Бостандыкский район, ЖК ...')).toBe(true);
  });
});

describe('isDeliverySelected', () => {
  it('is false when not a notarized order, regardless of fulfillmentMethod', () => {
    expect(isDeliverySelected({ isNotarization: false, fulfillmentMethod: 'delivery' })).toBe(false);
  });

  it('is true only for notarized + delivery', () => {
    expect(isDeliverySelected({ isNotarization: true, fulfillmentMethod: 'delivery' })).toBe(true);
    expect(isDeliverySelected({ isNotarization: true, fulfillmentMethod: 'pickup' })).toBe(false);
  });
});

describe('isNotaryDeliveryValid', () => {
  it('non-notarized orders are always valid (electronic/official flows unaffected)', () => {
    expect(isNotaryDeliveryValid(baseState({
      isNotarization: false, notaryCity: '', fulfillmentMethod: '', deliveryPhone: '', deliveryAddress: '',
    }))).toBe(true);
  });

  it('pickup does not require phone or address', () => {
    expect(isNotaryDeliveryValid(baseState({
      fulfillmentMethod: 'pickup', deliveryPhone: '', deliveryAddress: '',
    }))).toBe(true);
  });

  it('delivery requires a phone number', () => {
    expect(isNotaryDeliveryValid(baseState({ deliveryPhone: '' }))).toBe(false);
    expect(isNotaryDeliveryValid(baseState({ deliveryPhone: '   ' }))).toBe(false);
  });

  it('delivery requires a delivery address', () => {
    expect(isNotaryDeliveryValid(baseState({ deliveryAddress: '' }))).toBe(false);
    expect(isNotaryDeliveryValid(baseState({ deliveryAddress: '   ' }))).toBe(false);
  });

  it('a manually typed free-text delivery address is valid — no autocomplete/placeId/structured object required', () => {
    for (const address of [
      'Казыбек Би 10, кв. 25',
      'ул. Абая, дом 12, офис 4',
      'Алматы, Бостандыкский район, ЖК ...',
    ]) {
      expect(isNotaryDeliveryValid(baseState({ deliveryAddress: address }))).toBe(true);
    }
  });

  it('requires a notary city for any notarized order', () => {
    expect(isNotaryDeliveryValid(baseState({ notaryCity: '' }))).toBe(false);
  });

  it('requires a fulfillment method to be chosen', () => {
    expect(isNotaryDeliveryValid(baseState({ fulfillmentMethod: '' }))).toBe(false);
  });

  it('switching delivery -> pickup drops the phone/address requirement even if they are left empty', () => {
    const deliveryInvalid = baseState({ deliveryPhone: '', deliveryAddress: '' });
    expect(isNotaryDeliveryValid(deliveryInvalid)).toBe(false);
    const afterSwitchToPickup = { ...deliveryInvalid, fulfillmentMethod: 'pickup' };
    expect(isNotaryDeliveryValid(afterSwitchToPickup)).toBe(true);
  });

  it('switching pickup -> delivery re-imposes the phone/address requirement', () => {
    const pickupValid = baseState({ fulfillmentMethod: 'pickup', deliveryPhone: '', deliveryAddress: '' });
    expect(isNotaryDeliveryValid(pickupValid)).toBe(true);
    const afterSwitchToDelivery = { ...pickupValid, fulfillmentMethod: 'delivery' };
    expect(isNotaryDeliveryValid(afterSwitchToDelivery)).toBe(false);
  });

  it('requires an explicit individual/legal_entity applicant type for any notarized order', () => {
    expect(isNotaryDeliveryValid(baseState({ applicantType: '' }))).toBe(false);
    expect(isNotaryDeliveryValid(baseState({ applicantType: 'unknown' }))).toBe(false);
    expect(isNotaryDeliveryValid(baseState({ applicantType: 'individual' }))).toBe(true);
    expect(isNotaryDeliveryValid(baseState({ applicantType: 'legal_entity' }))).toBe(true);
  });
});
