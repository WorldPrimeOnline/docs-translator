import {
  extractSelectValue,
  extractTextValue,
  extractNumericTextValue,
  buildOrderBroadcastData,
  buildOrderBroadcastMessage,
  resolveStatusMapping,
  buildStatusUpdateMessage,
  REQUIRED_STATUS_FOR_ACTION,
} from '../order-message';
import { JIRA_FIELDS, type JiraIssueSnapshot } from '@/lib/jira/client';

function makeIssue(fields: Record<string, unknown>): JiraIssueSnapshot {
  return { key: 'WO-123', statusName: 'OPEN', fields };
}

describe('field extraction helpers', () => {
  it('extractSelectValue reads {value} shape', () => {
    expect(extractSelectValue({ id: '1', value: 'Доверенность' })).toBe('Доверенность');
  });

  it('extractSelectValue returns null for missing/malformed field', () => {
    expect(extractSelectValue(null)).toBeNull();
    expect(extractSelectValue(undefined)).toBeNull();
    expect(extractSelectValue({})).toBeNull();
  });

  it('extractTextValue reads plain strings and rejects empty', () => {
    expect(extractTextValue('hello')).toBe('hello');
    expect(extractTextValue('')).toBeNull();
    expect(extractTextValue(null)).toBeNull();
  });

  it('extractNumericTextValue parses a text-serialized number and rejects everything else', () => {
    expect(extractNumericTextValue('3')).toBe(3);
    expect(extractNumericTextValue('4500')).toBe(4500);
    expect(extractNumericTextValue('2.5')).toBe(2.5);
    expect(extractNumericTextValue('0')).toBe(0);
    expect(extractNumericTextValue('')).toBeNull();
    expect(extractNumericTextValue(null)).toBeNull();
    expect(extractNumericTextValue(undefined)).toBeNull();
    expect(extractNumericTextValue('not-a-number')).toBeNull();
    expect(extractNumericTextValue(3)).toBeNull(); // native number, not text — never expected from these fields, but must not be silently accepted
  });
});

describe('REQUIRED_STATUS_FOR_ACTION', () => {
  it('defines the exact precondition status for every action', () => {
    expect(REQUIRED_STATUS_FOR_ACTION).toEqual({
      translator_claim: 'OPEN',
      translator_start: 'НАЗНАЧЕН ПЕРЕВОДЧИК',
      translator_done: 'ПЕРЕВОД В РАБОТЕ',
      notary_claim: 'ПЕРЕВОД ЗАВЕРШЕН',
      notary_start: 'НАЗНАЧЕН НОТАРИУС',
      notary_done: 'В РАБОТЕ У НОТАРИУСА',
    });
  });
});

describe('buildOrderBroadcastData', () => {
  it('maps Jira fields + Supabase extras into broadcast data', () => {
    const issue = makeIssue({
      [JIRA_FIELDS.translationType]: { value: 'Нотариально заверенный' },
      [JIRA_FIELDS.languagePair]: 'Русский → Английский',
      [JIRA_FIELDS.documentType]: { value: 'Доверенность' },
      [JIRA_FIELDS.documentsLink]: 'https://drive.example/folder',
    });
    const data = buildOrderBroadcastData(issue, 'notary', { pageCount: 3, payoutKzt: 4500 });
    expect(data).toEqual({
      issueKey: 'WO-123',
      role: 'notary',
      translationType: 'Нотариально заверенный',
      languagePair: 'Русский → Английский',
      documentType: 'Доверенность',
      pageCount: 3,
      payoutKzt: 4500,
      driveUrl: 'https://drive.example/folder',
    });
  });

  it('omits missing values without fabricating placeholders', () => {
    const issue = makeIssue({});
    const data = buildOrderBroadcastData(issue, 'translator', { pageCount: null, payoutKzt: null });
    expect(data.translationType).toBeNull();
    expect(data.pageCount).toBeNull();
    expect(data.payoutKzt).toBeNull();
    expect(data.driveUrl).toBeNull();
  });
});

describe('buildOrderBroadcastMessage', () => {
  it('renders full details with translator claim button', () => {
    const { text, buttons } = buildOrderBroadcastMessage({
      issueKey: 'WO-123',
      role: 'translator',
      translationType: 'Нотариально заверенный',
      languagePair: 'RU → EN',
      documentType: 'Доверенность',
      pageCount: 3,
      payoutKzt: 4500,
      driveUrl: 'https://drive.example/x',
    });
    expect(text).toContain('🆕 <b>WO-123</b>');
    expect(text).toContain('Тип услуги: Нотариально заверенный');
    expect(text).toContain('Тип документа: Доверенность');
    expect(text).toContain('Языковая пара: RU → EN');
    expect(text).toContain('Оплачиваемые страницы: 3');
    expect(text).toContain('Выплата переводчику: 4 500 ₸');
    expect(text).toContain('Материалы: https://drive.example/x');
    expect(text).toContain('Исполнитель: не назначен');
    expect(buttons).toEqual([{ text: '🙋 Назначить себя', callback_data: 'translator_claim:WO-123' }]);
  });

  it('uses the notary-specific payout label', () => {
    const { text } = buildOrderBroadcastMessage({
      issueKey: 'WO-9',
      role: 'notary',
      translationType: 'Нотариально заверенный',
      languagePair: 'RU → EN',
      documentType: 'Доверенность',
      pageCount: 2,
      payoutKzt: 3000,
      driveUrl: null,
    });
    expect(text).toContain('Выплата нотариусу: 3 000 ₸');
  });

  it('renders notary claim button with ⚖️ and notary_claim action', () => {
    const { buttons } = buildOrderBroadcastMessage({
      issueKey: 'WO-9',
      role: 'notary',
      translationType: null,
      languagePair: null,
      documentType: null,
      pageCount: null,
      payoutKzt: null,
      driveUrl: null,
    });
    expect(buttons).toEqual([{ text: '⚖️ Назначить себя', callback_data: 'notary_claim:WO-9' }]);
  });

  it('omits page-count and payout lines when both are absent from Jira/Supabase', () => {
    const { text } = buildOrderBroadcastMessage({
      issueKey: 'WO-5',
      role: 'translator',
      translationType: 'Сертифицированный переводчиком',
      languagePair: 'RU → EN',
      documentType: 'Диплом',
      pageCount: null,
      payoutKzt: null,
      driveUrl: null,
    });
    expect(text).not.toContain('Оплачиваемые страницы');
    expect(text).not.toContain('Выплата переводчику');
  });
});

describe('resolveStatusMapping', () => {
  it('resolves translator statuses', () => {
    expect(resolveStatusMapping('НАЗНАЧЕН ПЕРЕВОДЧИК')).toEqual({
      role: 'translator',
      entry: expect.objectContaining({ internalStatus: 'claimed' }),
    });
    expect(resolveStatusMapping('ПЕРЕВОД В РАБОТЕ')?.entry.internalStatus).toBe('in_progress');
    expect(resolveStatusMapping('ПЕРЕВОД ЗАВЕРШЕН')?.entry.internalStatus).toBe('completed');
  });

  it('resolves notary statuses', () => {
    expect(resolveStatusMapping('НАЗНАЧЕН НОТАРИУС')?.role).toBe('notary');
    expect(resolveStatusMapping('В РАБОТЕ У НОТАРИУСА')?.entry.internalStatus).toBe('in_progress');
    expect(resolveStatusMapping('ПЕРЕВОД ЗАВЕРЕН')?.entry.internalStatus).toBe('completed');
  });

  it('returns null for unrelated Jira statuses', () => {
    expect(resolveStatusMapping('OPEN')).toBeNull();
    expect(resolveStatusMapping('OUT_FOR_DELIVERY')).toBeNull();
    expect(resolveStatusMapping('Закрыто')).toBeNull();
  });

  // Regression: WO-122 production incident (2026-08-10) — Jira Automation's real
  // status_changed payload sends sentence case ("Назначен переводчик"), not the
  // ALL-CAPS this file's maps use internally. Every case below is the exact casing
  // Jira Automation actually sends in production.
  it('resolves real Jira Automation sentence-case status values (not just this file\'s internal ALL-CAPS keys)', () => {
    expect(resolveStatusMapping('Назначен переводчик')).toEqual({
      role: 'translator',
      entry: expect.objectContaining({ internalStatus: 'claimed' }),
    });
    expect(resolveStatusMapping('Перевод в работе')?.entry.internalStatus).toBe('in_progress');
    expect(resolveStatusMapping('Перевод завершен')?.entry.internalStatus).toBe('completed');
    expect(resolveStatusMapping('Назначен нотариус')?.role).toBe('notary');
    expect(resolveStatusMapping('В работе у нотариуса')?.entry.internalStatus).toBe('in_progress');
    expect(resolveStatusMapping('Перевод заверен')?.entry.internalStatus).toBe('completed');
  });

  it('is whitespace-tolerant on top of case-insensitivity', () => {
    expect(resolveStatusMapping('  Назначен переводчик  ')?.role).toBe('translator');
  });

  it('still resolves the internal ALL-CAPS keys unchanged (no regression on the existing convention)', () => {
    expect(resolveStatusMapping('НАЗНАЧЕН ПЕРЕВОДЧИК')?.role).toBe('translator');
    expect(resolveStatusMapping('НАЗНАЧЕН НОТАРИУС')?.role).toBe('notary');
  });
});

describe('buildStatusUpdateMessage', () => {
  // WO-122 incident (2026-08-10): this used to render a bare issueKey/executor/status
  // summary, discarding the full order card the original broadcast showed. It must
  // now re-render the exact same order-detail lines buildOrderBroadcastMessage does.
  const fullData = {
    issueKey: 'WO-123',
    role: 'translator' as const,
    translationType: 'Нотариально заверенный',
    languagePair: 'RU → EN',
    documentType: 'Доверенность',
    pageCount: 3,
    payoutKzt: 4500,
    driveUrl: 'https://drive.example/x',
  };

  it('re-renders the full order card (not a bare summary) with the current status/executor/next-button', () => {
    const mapping = resolveStatusMapping('НАЗНАЧЕН ПЕРЕВОДЧИК')!;
    const { text, buttons } = buildStatusUpdateMessage({
      data: fullData,
      jiraStatus: 'НАЗНАЧЕН ПЕРЕВОДЧИК',
      entry: mapping.entry,
      executorName: 'Aigerim',
    });
    expect(text).toContain('🟡 <b>WO-123</b>');
    expect(text).toContain('Тип услуги: Нотариально заверенный');
    expect(text).toContain('Тип документа: Доверенность');
    expect(text).toContain('Языковая пара: RU → EN');
    expect(text).toContain('Оплачиваемые страницы: 3');
    expect(text).toContain('Выплата переводчику: 4 500 ₸');
    expect(text).toContain('Материалы: https://drive.example/x');
    expect(text).toContain('Исполнитель: Aigerim');
    expect(text).toContain('Статус: НАЗНАЧЕН ПЕРЕВОДЧИК');
    expect(buttons).toEqual([{ text: '▶️ Взять в работу', callback_data: 'translator_start:WO-123' }]);
  });

  it('renders terminal state with no buttons', () => {
    const mapping = resolveStatusMapping('ПЕРЕВОД ЗАВЕРЕН')!;
    const { buttons } = buildStatusUpdateMessage({
      data: { ...fullData, issueKey: 'WO-9', role: 'notary' as const },
      jiraStatus: 'ПЕРЕВОД ЗАВЕРЕН',
      entry: mapping.entry,
      executorName: 'Notary A',
    });
    expect(buttons).toEqual([]);
  });

  it('falls back to "не назначен" when executorName is null', () => {
    const mapping = resolveStatusMapping('ПЕРЕВОД В РАБОТЕ')!;
    const { text } = buildStatusUpdateMessage({
      data: { ...fullData, issueKey: 'WO-1' },
      jiraStatus: 'ПЕРЕВОД В РАБОТЕ',
      entry: mapping.entry,
      executorName: null,
    });
    expect(text).toContain('Исполнитель: не назначен');
  });

  it('uses the notary-specific payout label when role is notary', () => {
    const mapping = resolveStatusMapping('В РАБОТЕ У НОТАРИУСА')!;
    const { text } = buildStatusUpdateMessage({
      data: { ...fullData, issueKey: 'WO-9', role: 'notary' as const },
      jiraStatus: 'В РАБОТЕ У НОТАРИУСА',
      entry: mapping.entry,
      executorName: 'Notary A',
    });
    expect(text).toContain('Выплата нотариусу: 4 500 ₸');
    expect(text).not.toContain('Выплата переводчику');
  });

  // Regression: real Jira Automation status casing must produce the identical full
  // card, not just resolve — resolving without preserving order details would still
  // reproduce the WO-122 "tiny message" symptom.
  it('preserves full order-detail lines and displays the real sentence-case status text as-is', () => {
    const mapping = resolveStatusMapping('Перевод в работе')!;
    const { text } = buildStatusUpdateMessage({
      data: fullData,
      jiraStatus: 'Перевод в работе',
      entry: mapping.entry,
      executorName: 'Aigerim',
    });
    expect(text).toContain('Тип услуги: Нотариально заверенный');
    expect(text).toContain('Оплачиваемые страницы: 3');
    expect(text).toContain('Статус: Перевод в работе');
  });
});
