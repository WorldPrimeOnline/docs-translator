import { buildJiraIssueFields, JIRA_FIELDS, buildApplicantTypeDescriptionLine } from '../order-fields';
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

// ── totalCost (customfield_10077) ──────────────────────────────────────────────

describe('totalCost field', () => {
  it('omits totalCost when amountKzt is not provided', () => {
    const fields = buildJiraIssueFields(BASE_INPUT);
    expect(fields[JIRA_FIELDS.totalCost]).toBeUndefined();
  });

  it('omits totalCost when amountKzt is null', () => {
    const fields = buildJiraIssueFields({ ...BASE_INPUT, amountKzt: null });
    expect(fields[JIRA_FIELDS.totalCost]).toBeUndefined();
  });

  it('omits totalCost when amountKzt is 0', () => {
    const fields = buildJiraIssueFields({ ...BASE_INPUT, amountKzt: 0 });
    expect(fields[JIRA_FIELDS.totalCost]).toBeUndefined();
  });

  it('sets totalCost when a positive amountKzt is provided', () => {
    const fields = buildJiraIssueFields({ ...BASE_INPUT, amountKzt: 9990 });
    expect(fields[JIRA_FIELDS.totalCost]).toBe(9990);
  });
});

// ── buildApplicantTypeDescriptionLine (WO-75 incident follow-up, 2026-07-10) ──
// individual vs legal_entity determines the notary official fee tier but had no
// visibility in Jira — no custom field exists for it, so it's a description line.

describe('buildApplicantTypeDescriptionLine', () => {
  const NOTARIZED = 'notarization_through_partners';

  it('returns the individual label for a notarized order', () => {
    expect(buildApplicantTypeDescriptionLine(NOTARIZED, 'individual'))
      .toBe('Тип заказчика для нотариального тарифа: Физическое лицо');
  });

  it('returns the legal_entity label for a notarized order', () => {
    expect(buildApplicantTypeDescriptionLine(NOTARIZED, 'legal_entity'))
      .toBe('Тип заказчика для нотариального тарифа: Юридическое лицо');
  });

  it('returns the safe "Не указан" line (never fabricates individual) for the unknown value', () => {
    expect(buildApplicantTypeDescriptionLine(NOTARIZED, 'unknown'))
      .toBe('Тип заказчика для нотариального тарифа: Не указан');
  });

  it('returns the safe "Не указан" line (never fabricates individual) when applicantType is null — old order, never recorded', () => {
    expect(buildApplicantTypeDescriptionLine(NOTARIZED, null))
      .toBe('Тип заказчика для нотариального тарифа: Не указан');
  });

  it('returns the safe "Не указан" line when applicantType is undefined', () => {
    expect(buildApplicantTypeDescriptionLine(NOTARIZED, undefined))
      .toBe('Тип заказчика для нотариального тарифа: Не указан');
  });

  it('returns the safe "Не указан" line for any unsupported/unexpected value — no DB CHECK constraint guarantees the TS type at runtime', () => {
    expect(buildApplicantTypeDescriptionLine(NOTARIZED, 'some-corrupt-value'))
      .toBe('Тип заказчика для нотариального тарифа: Не указан');
  });

  it('returns null for a non-notarized order — no line at all, not even "Не указан", since the two-tier notary fee does not apply', () => {
    expect(buildApplicantTypeDescriptionLine('official_with_translator_signature_and_provider_stamp', 'individual')).toBeNull();
    expect(buildApplicantTypeDescriptionLine('electronic', 'legal_entity')).toBeNull();
    expect(buildApplicantTypeDescriptionLine('electronic', null)).toBeNull();
  });
});
