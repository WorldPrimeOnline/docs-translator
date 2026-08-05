/**
 * WO-110 fix, requirement 4: Official's "Готово" badge must not depend on
 * canDownload — the translator's own signature+stamp (translator_approved) is
 * "done" the moment it happens, independent of whether the result file has synced
 * from Drive yet. Notary's legacy translator_approved must stay non-"done".
 */
import { isCompletedBadge } from '../status-badge';

const OFFICIAL = 'official_with_translator_signature_and_provider_stamp';
const NOTARY = 'notarization_through_partners';

describe('isCompletedBadge', () => {
  it('Official translator_approved is always "Готово" — regardless of file/download readiness (canDownload is not even a parameter)', () => {
    expect(isCompletedBadge('translator_approved', OFFICIAL)).toBe(true);
  });

  it('Notary translator_approved (legacy) is NOT "Готово" — work is still ongoing', () => {
    expect(isCompletedBadge('translator_approved', NOTARY)).toBe(false);
  });

  it('electronic completed is "Готово"', () => {
    expect(isCompletedBadge('completed', 'electronic')).toBe(true);
  });

  it('certified delivered/ready_for_delivery/picked_up stay "Готово" (unaffected, pre-existing statuses)', () => {
    expect(isCompletedBadge('delivered', OFFICIAL)).toBe(true);
    expect(isCompletedBadge('ready_for_delivery', OFFICIAL)).toBe(true);
    expect(isCompletedBadge('picked_up', NOTARY)).toBe(true);
  });

  it('in-progress statuses never show "Готово"', () => {
    expect(isCompletedBadge('translator_review_in_progress', OFFICIAL)).toBe(false);
    expect(isCompletedBadge('awaiting_translator_review', OFFICIAL)).toBe(false);
    expect(isCompletedBadge('assigned_to_notary', NOTARY)).toBe(false);
    expect(isCompletedBadge('notarized', NOTARY)).toBe(false);
  });

  it('null customerStatus (defaults to queued) is never "Готово"', () => {
    expect(isCompletedBadge(null, OFFICIAL)).toBe(false);
  });

  it('translator_approved with no serviceLevel provided is never "Готово" — must not default-assume Official', () => {
    expect(isCompletedBadge('translator_approved', undefined)).toBe(false);
    expect(isCompletedBadge('translator_approved', null)).toBe(false);
  });

  it('WO-112 fix: "closed" (Jira "Закрыто") is "Готово" for every service level, no serviceLevel check needed', () => {
    expect(isCompletedBadge('closed', NOTARY)).toBe(true);
    expect(isCompletedBadge('closed', OFFICIAL)).toBe(true);
    expect(isCompletedBadge('closed', 'electronic')).toBe(true);
    expect(isCompletedBadge('closed', undefined)).toBe(true);
    expect(isCompletedBadge('closed', null)).toBe(true);
  });
});
