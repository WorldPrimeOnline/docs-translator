import { telegramRoleFieldIds, payoutFieldForRole, PAGE_COUNT_FIELD } from '../jira-fields';
import { JIRA_FIELDS } from '@/lib/jira/client';

describe('telegramRoleFieldIds', () => {
  it('returns the hardcoded translator field IDs for role=translator', () => {
    expect(telegramRoleFieldIds('translator')).toEqual({
      messageId: JIRA_FIELDS.telegramTranslatorMessageId,
      userId: JIRA_FIELDS.telegramTranslatorUserId,
      displayName: JIRA_FIELDS.telegramTranslatorName,
    });
  });

  it('returns the hardcoded notary field IDs for role=notary', () => {
    expect(telegramRoleFieldIds('notary')).toEqual({
      messageId: JIRA_FIELDS.telegramNotaryMessageId,
      userId: JIRA_FIELDS.telegramNotaryUserId,
      displayName: JIRA_FIELDS.telegramNotaryName,
    });
  });

  it('never returns undefined — these are always-hardcoded constants, not optional config', () => {
    const translator = telegramRoleFieldIds('translator');
    const notary = telegramRoleFieldIds('notary');
    expect(Object.values(translator).every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
    expect(Object.values(notary).every((v) => typeof v === 'string' && v.length > 0)).toBe(true);
  });
});

describe('payoutFieldForRole', () => {
  it('returns the translator payout field for role=translator', () => {
    expect(payoutFieldForRole('translator')).toBe(JIRA_FIELDS.translatorPayout);
  });

  it('returns the notary payout field for role=notary', () => {
    expect(payoutFieldForRole('notary')).toBe(JIRA_FIELDS.notaryPayout);
  });
});

describe('PAGE_COUNT_FIELD', () => {
  it('is the shared payable-page-count field', () => {
    expect(PAGE_COUNT_FIELD).toBe(JIRA_FIELDS.payablePageCount);
  });
});
