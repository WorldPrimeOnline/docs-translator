import { telegramRoleFieldIds, pageCountFieldId, payoutFieldId } from '../jira-fields';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('telegramRoleFieldIds', () => {
  it('returns translator field IDs for role=translator', () => {
    process.env.JIRA_FIELD_TG_TRANSLATOR_MESSAGE_ID = 'customfield_20001';
    process.env.JIRA_FIELD_TG_TRANSLATOR_USER_ID = 'customfield_20002';
    process.env.JIRA_FIELD_TG_TRANSLATOR_NAME = 'customfield_20003';

    expect(telegramRoleFieldIds('translator')).toEqual({
      messageId: 'customfield_20001',
      userId: 'customfield_20002',
      displayName: 'customfield_20003',
    });
  });

  it('returns notary field IDs for role=notary', () => {
    process.env.JIRA_FIELD_TG_NOTARY_MESSAGE_ID = 'customfield_20004';
    process.env.JIRA_FIELD_TG_NOTARY_USER_ID = 'customfield_20005';
    process.env.JIRA_FIELD_TG_NOTARY_NAME = 'customfield_20006';

    expect(telegramRoleFieldIds('notary')).toEqual({
      messageId: 'customfield_20004',
      userId: 'customfield_20005',
      displayName: 'customfield_20006',
    });
  });

  it('returns undefined for any field whose env var is not configured', () => {
    delete process.env.JIRA_FIELD_TG_TRANSLATOR_MESSAGE_ID;
    delete process.env.JIRA_FIELD_TG_TRANSLATOR_USER_ID;
    delete process.env.JIRA_FIELD_TG_TRANSLATOR_NAME;

    expect(telegramRoleFieldIds('translator')).toEqual({
      messageId: undefined,
      userId: undefined,
      displayName: undefined,
    });
  });
});

describe('pageCountFieldId / payoutFieldId', () => {
  it('read the shared (non-role-specific) env vars', () => {
    process.env.JIRA_FIELD_TG_PAGE_COUNT = 'customfield_20007';
    process.env.JIRA_FIELD_TG_PAYOUT_AMOUNT_KZT = 'customfield_20008';
    expect(pageCountFieldId()).toBe('customfield_20007');
    expect(payoutFieldId()).toBe('customfield_20008');
  });

  it('return undefined when not configured', () => {
    delete process.env.JIRA_FIELD_TG_PAGE_COUNT;
    delete process.env.JIRA_FIELD_TG_PAYOUT_AMOUNT_KZT;
    expect(pageCountFieldId()).toBeUndefined();
    expect(payoutFieldId()).toBeUndefined();
  });
});
