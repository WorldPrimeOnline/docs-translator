/**
 * Whether the dashboard StatusBadge (src/app/[locale]/dashboard/page.tsx) shows the
 * green "Готово" badge — 2026-08-05 WO-110 fix, requirement 4.
 *
 * 'translator_approved' means two different things depending on service level (see
 * customer-order-state.ts's deriveCustomerStatus/canCustomerDownload): for Official
 * it IS the final step — the translator's own signature+stamp — so the badge reads
 * "Готово" immediately, the moment workflow_status flips, regardless of whether the
 * result file has synced from Drive yet (canDownload only gates the download
 * button — a separate, later-arriving signal, never the badge). For Notary this same
 * raw value is legacy-only and means "approved for notary, work still ongoing" —
 * must never read as done.
 */
export function isCompletedBadge(customerStatus: string | null, serviceLevel: string | null | undefined): boolean {
  const status = customerStatus ?? 'queued';
  const officialDone = status === 'translator_approved' && serviceLevel === 'official_with_translator_signature_and_provider_stamp';
  return (
    status === 'completed' ||
    status === 'delivered' ||
    status === 'picked_up' ||
    status === 'ready_for_delivery' ||
    // 2026-08-05 WO-112 fix: Jira "Закрыто" (customerStatus='closed') is done for
    // EVERY service level — unlike officialDone above, this one needs no
    // serviceLevel check at all.
    status === 'closed' ||
    officialDone
  );
}
