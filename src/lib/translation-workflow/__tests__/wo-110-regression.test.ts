/**
 * WO-110 regression suite (2026-08-05 staging incident).
 *
 * Real scenario: Official order, workflow_status=translator_approved, dashboard
 * correctly showed 100% / "Официальный перевод готов" — but the file the operator
 * placed at Google Drive's 04_SIGNATURE_AND_STAMP/signed.pdf never turned into a
 * working download button, even after waiting, reloading, and renaming the file.
 *
 * Root cause, confirmed via read-only staging DB audit
 * (scripts/support/inspect-customer-order.ts --job-id 1a55cec2-461f-484b-b7ac-3af7628a3eb8)
 * plus the WO-108 fix's own audit-log observability, which caught it live:
 *   job_audit_log: action=result_sync_stuck_signature_stamp, reason=
 *   'mapping validation failed: "signed": no NNN/NNN-MMM sequence prefix, but this
 *   job has 5 source files (an unprefixed filename is only allowed when there is
 *   exactly one source file); no result file covers source sequence(s): 1, 2, 3, 4, 5'
 *
 * validateResultFileMapping() (worker/src/lib/result-file-mapping.ts) rejected any
 * unprefixed filename outright once a job had more than one source file — contrary
 * to the actual business rule ("any normal file an operator drops in the folder
 * must sync"), where a prefix is only an OPTIONAL disambiguation hint. This file
 * locks in the customer-facing side of the fix: once job_result_files has the
 * resulting 'ready' row (see result-file-sync.test.ts for the worker-side mapping/
 * sync fix itself), the exact same order becomes downloadable everywhere it can
 * appear, and the "Готово" badge was never gated on file readiness to begin with.
 */
import { getCustomerOrderState } from '../customer-order-state';
import { resolveDownloadAction } from '../download-action';
import { isCompletedBadge } from '../status-badge';

const OFFICIAL = 'official_with_translator_signature_and_provider_stamp';
const NOTARY = 'notarization_through_partners';

describe('WO-110: Official translator_approved, before the ready result exists', () => {
  it('canDownload is false, but the badge still reads "Готово" (requirement 4 — badge never depends on canDownload)', () => {
    const state = getCustomerOrderState({
      jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_approved',
      serviceLevel: OFFICIAL, hasReadyResultFiles: false,
    });
    expect(state.canDownload).toBe(false);
    expect(state.progressPercent).toBe(100);
    expect(isCompletedBadge(state.customerStatus, OFFICIAL)).toBe(true);
  });

  it('no false download button while the signature_stamp result is not yet synced', () => {
    const state = getCustomerOrderState({
      jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_approved',
      serviceLevel: OFFICIAL, hasReadyResultFiles: false,
    });
    const order = { documentId: 'wo-110-doc', canDownload: state.canDownload };
    expect(resolveDownloadAction(order)).toEqual({ visible: false, href: null });
  });
});

describe('WO-110 fixed: once job_result_files has the signature_stamp row from signed.pdf', () => {
  it('canDownload flips true, badge stays "Готово" (unaffected — it was never gated on this)', () => {
    const state = getCustomerOrderState({
      jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_approved',
      serviceLevel: OFFICIAL, hasReadyResultFiles: true,
    });
    expect(state.canDownload).toBe(true);
    expect(isCompletedBadge(state.customerStatus, OFFICIAL)).toBe(true);
  });

  it('the download button appears, identically, wherever the order is rendered (ActiveOrderCard or HistoryRow both call resolveDownloadAction on the same entry)', () => {
    const state = getCustomerOrderState({
      jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_approved',
      serviceLevel: OFFICIAL, hasReadyResultFiles: true,
    });
    const order = { documentId: 'wo-110-doc', canDownload: state.canDownload };
    const asActiveCard = resolveDownloadAction(order);
    const asHistoryRow = resolveDownloadAction({ ...order });
    expect(asActiveCard).toEqual({ visible: true, href: '/api/documents/wo-110-doc/download' });
    expect(asHistoryRow).toEqual(asActiveCard);
  });
});

describe('WO-110 requirement 4: Notary translator_approved must NOT read as "Готово"', () => {
  it('Notary translator_approved (legacy) stays the intermediate badge — work is not actually finished (real path sets assigned_to_notary instead)', () => {
    const state = getCustomerOrderState({
      jobStatus: 'completed', progressPercent: 100, workflowStatus: 'translator_approved', serviceLevel: NOTARY,
    });
    expect(isCompletedBadge(state.customerStatus, NOTARY)).toBe(false);
  });
});
