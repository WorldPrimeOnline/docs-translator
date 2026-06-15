import { buildJiraIssueFields, temporaryOrderPrice, JIRA_FIELDS } from '../order-fields';
import type { JiraIssueFieldsInput } from '../order-fields';

const BASE_INPUT: JiraIssueFieldsInput = {
  orderId: '00000000-0000-4000-8000-000000000001',
  customerId: 'user-abc',
  sourceLang: 'kk',
  targetLang: 'ru',
  documentType: 'passport_id',
  serviceLevel: 'official_with_translator_signature_and_provider_stamp',
  paymentSource: 'subscription',
  fulfillmentMethod: null,
  deliveryPhone: null,
  deliveryAddress: null,
  driveUrl: null,
};

describe('buildJiraIssueFields', () => {
  // ── 1. Required identifiers ────────────────────────────────────────────────

  it('includes orderId in customfield_10073', () => {
    const fields = buildJiraIssueFields(BASE_INPUT);
    expect(fields[JIRA_FIELDS.orderId]).toBe(BASE_INPUT.orderId);
  });

  it('includes customerId in customfield_10074', () => {
    const fields = buildJiraIssueFields(BASE_INPUT);
    expect(fields[JIRA_FIELDS.customerId]).toBe('user-abc');
  });

  it('omits customerId field when customerId is null', () => {
    const fields = buildJiraIssueFields({ ...BASE_INPUT, customerId: null });
    expect(fields[JIRA_FIELDS.customerId]).toBeUndefined();
  });

  // ── 2. Language pair ───────────────────────────────────────────────────────

  it('formats language pair in Russian with →', () => {
    const fields = buildJiraIssueFields(BASE_INPUT);
    expect(fields[JIRA_FIELDS.languagePair]).toBe('Казахский → Русский');
  });

  it('uses "Автоопределение" for auto source language', () => {
    const fields = buildJiraIssueFields({ ...BASE_INPUT, sourceLang: 'auto' });
    expect(fields[JIRA_FIELDS.languagePair]).toBe('Автоопределение → Русский');
  });

  it('falls back to uppercase code for unknown language', () => {
    const fields = buildJiraIssueFields({ ...BASE_INPUT, sourceLang: 'xx' });
    expect(fields[JIRA_FIELDS.languagePair]).toBe('XX → Русский');
  });

  // ── 3. Document type ───────────────────────────────────────────────────────

  it('maps passport_id to "Паспорт" single-select', () => {
    const fields = buildJiraIssueFields(BASE_INPUT);
    expect(fields[JIRA_FIELDS.documentType]).toEqual({ value: 'Паспорт' });
  });

  it('strips output-format suffix before mapping (passport_id|pdf)', () => {
    const fields = buildJiraIssueFields({ ...BASE_INPUT, documentType: 'passport_id|pdf' });
    expect(fields[JIRA_FIELDS.documentType]).toEqual({ value: 'Паспорт' });
  });

  it('maps unknown document type to "Другое"', () => {
    const fields = buildJiraIssueFields({ ...BASE_INPUT, documentType: 'nonexistent' });
    expect(fields[JIRA_FIELDS.documentType]).toEqual({ value: 'Другое' });
  });

  // ── 4. Delivery PII — only for delivery fulfillment ───────────────────────

  it('omits delivery phone and address for pickup fulfillment', () => {
    const fields = buildJiraIssueFields({
      ...BASE_INPUT,
      fulfillmentMethod: 'pickup',
      deliveryPhone: '+77001234567',
      deliveryAddress: 'ул. Абая 1',
    });
    expect(fields[JIRA_FIELDS.deliveryPhone]).toBeUndefined();
    expect(fields[JIRA_FIELDS.deliveryAddress]).toBeUndefined();
  });

  it('includes delivery phone and address for delivery fulfillment', () => {
    const fields = buildJiraIssueFields({
      ...BASE_INPUT,
      fulfillmentMethod: 'delivery',
      deliveryPhone: '+77001234567',
      deliveryAddress: 'ул. Абая 1',
    });
    expect(fields[JIRA_FIELDS.deliveryPhone]).toBe('+77001234567');
    expect(fields[JIRA_FIELDS.deliveryAddress]).toBe('ул. Абая 1');
  });

  it('omits delivery phone and address when fulfillmentMethod is null', () => {
    const fields = buildJiraIssueFields({
      ...BASE_INPUT,
      fulfillmentMethod: null,
      deliveryPhone: '+77001234567',
      deliveryAddress: 'ул. Абая 1',
    });
    expect(fields[JIRA_FIELDS.deliveryPhone]).toBeUndefined();
    expect(fields[JIRA_FIELDS.deliveryAddress]).toBeUndefined();
  });

  // ── 5. Payment method ──────────────────────────────────────────────────────

  it('maps subscription to "Подписка" single-select', () => {
    const fields = buildJiraIssueFields({ ...BASE_INPUT, paymentSource: 'subscription' });
    expect(fields[JIRA_FIELDS.paymentMethod]).toEqual({ value: 'Подписка' });
  });

  it('maps card_payment to "За документ" single-select', () => {
    const fields = buildJiraIssueFields({ ...BASE_INPUT, paymentSource: 'card_payment' });
    expect(fields[JIRA_FIELDS.paymentMethod]).toEqual({ value: 'За документ' });
  });

  it('maps null paymentSource to "За документ"', () => {
    const fields = buildJiraIssueFields({ ...BASE_INPUT, paymentSource: null });
    expect(fields[JIRA_FIELDS.paymentMethod]).toEqual({ value: 'За документ' });
  });

  // ── 6. Translation type ────────────────────────────────────────────────────

  it('sets certified translation type label', () => {
    const fields = buildJiraIssueFields(BASE_INPUT);
    expect(fields[JIRA_FIELDS.translationType]).toEqual({ value: 'Сертифицированный переводчиком' });
  });

  it('sets notarized translation type label', () => {
    const fields = buildJiraIssueFields({ ...BASE_INPUT, serviceLevel: 'notarization_through_partners' });
    expect(fields[JIRA_FIELDS.translationType]).toEqual({ value: 'Нотариально заверенный' });
  });

  // ── 7. Drive URL ───────────────────────────────────────────────────────────

  it('includes driveUrl in documentsLink field', () => {
    const url = 'https://drive.google.com/drive/folders/abc';
    const fields = buildJiraIssueFields({ ...BASE_INPUT, driveUrl: url });
    expect(fields[JIRA_FIELDS.documentsLink]).toBe(url);
  });

  it('omits documentsLink when driveUrl is null', () => {
    const fields = buildJiraIssueFields({ ...BASE_INPUT, driveUrl: null });
    expect(fields[JIRA_FIELDS.documentsLink]).toBeUndefined();
  });

  // ── 8. Fulfillment method ──────────────────────────────────────────────────

  it('maps pickup to "Самовывоз" single-select', () => {
    const fields = buildJiraIssueFields({ ...BASE_INPUT, fulfillmentMethod: 'pickup' });
    expect(fields[JIRA_FIELDS.fulfillmentMethod]).toEqual({ value: 'Самовывоз' });
  });

  it('maps delivery to "Курьер" single-select', () => {
    const fields = buildJiraIssueFields({ ...BASE_INPUT, fulfillmentMethod: 'delivery' });
    expect(fields[JIRA_FIELDS.fulfillmentMethod]).toEqual({ value: 'Курьер' });
  });

  it('omits fulfillmentMethod field when null', () => {
    const fields = buildJiraIssueFields({ ...BASE_INPUT, fulfillmentMethod: null });
    expect(fields[JIRA_FIELDS.fulfillmentMethod]).toBeUndefined();
  });
});

// ── temporaryOrderPrice ────────────────────────────────────────────────────────

describe('temporaryOrderPrice', () => {
  it('returns value in 5000–15000 KZT range', () => {
    const price = temporaryOrderPrice('00000000-0000-4000-8000-000000000001');
    expect(price).toBeGreaterThanOrEqual(5000);
    expect(price).toBeLessThanOrEqual(15000);
  });

  it('is deterministic — same orderId always yields same price', () => {
    const id = 'test-order-id-abc';
    expect(temporaryOrderPrice(id)).toBe(temporaryOrderPrice(id));
  });

  it('different orderIds produce different prices', () => {
    const p1 = temporaryOrderPrice('00000000-0000-4000-8000-000000000001');
    const p2 = temporaryOrderPrice('00000000-0000-4000-8000-000000000002');
    // Not guaranteed to differ in theory but overwhelmingly likely for any two UUIDs
    expect(p1).not.toBe(p2);
  });
});
