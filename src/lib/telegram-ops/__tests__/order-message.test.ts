import {
  extractSelectValue,
  extractTextValue,
  extractJobId,
  buildOrderBroadcastData,
  buildOrderBroadcastMessage,
  resolveStatusMapping,
  buildStatusUpdateMessage,
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

  it('extractJobId reads customfield_10073', () => {
    const issue = makeIssue({ [JIRA_FIELDS.orderId]: 'job-uuid-1' });
    expect(extractJobId(issue)).toBe('job-uuid-1');
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
    expect(text).toContain('3 стр.');
    expect(text).toContain('Сумма исполнителю: 4500 ₸');
    expect(text).toContain('Исполнитель: не назначен');
    expect(buttons).toEqual([{ text: '🙋 Назначить себя', callback_data: 'translator_claim:WO-123' }]);
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
    expect(text).not.toContain('стр.');
    expect(text).not.toContain('Сумма исполнителю');
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
});

describe('buildStatusUpdateMessage', () => {
  it('renders claimed state with start button', () => {
    const mapping = resolveStatusMapping('НАЗНАЧЕН ПЕРЕВОДЧИК')!;
    const { text, buttons } = buildStatusUpdateMessage({
      issueKey: 'WO-123',
      jiraStatus: 'НАЗНАЧЕН ПЕРЕВОДЧИК',
      entry: mapping.entry,
      executorName: 'Aigerim',
    });
    expect(text).toBe('🟡 <b>WO-123</b>\nИсполнитель: Aigerim\nСтатус: НАЗНАЧЕН ПЕРЕВОДЧИК');
    expect(buttons).toEqual([{ text: '▶️ Взять в работу', callback_data: 'translator_start:WO-123' }]);
  });

  it('renders terminal state with no buttons', () => {
    const mapping = resolveStatusMapping('ПЕРЕВОД ЗАВЕРЕН')!;
    const { buttons } = buildStatusUpdateMessage({
      issueKey: 'WO-9',
      jiraStatus: 'ПЕРЕВОД ЗАВЕРЕН',
      entry: mapping.entry,
      executorName: 'Notary A',
    });
    expect(buttons).toEqual([]);
  });

  it('falls back to "не назначен" when executorName is null', () => {
    const mapping = resolveStatusMapping('ПЕРЕВОД В РАБОТЕ')!;
    const { text } = buildStatusUpdateMessage({
      issueKey: 'WO-1',
      jiraStatus: 'ПЕРЕВОД В РАБОТЕ',
      entry: mapping.entry,
      executorName: null,
    });
    expect(text).toContain('Исполнитель: не назначен');
  });
});
