/**
 * Single source of truth for "does this dashboard row/card show a download button,
 * and where does it point" — 2026-08-01 WO-106 fix. Both ActiveOrderCard and
 * HistoryRow (src/app/[locale]/dashboard/page.tsx) call this instead of each
 * inlining `entry.canDownload && <a href={...}>`, so the two surfaces can never
 * silently diverge on which orders get a working download link.
 *
 * `canDownload` itself is computed once, server-side, by getCustomerOrderState()
 * (see customer-order-state.ts) and shipped down via /api/jobs — this module never
 * re-derives or second-guesses that decision, only turns it into a render-ready
 * shape. The actual file served at the href is selected server-side by
 * /api/documents/[documentId]/download (priority: notary result > official signed/
 * stamped result > electronic final result — see getResultFilesStatus's
 * STAGES_BY_SERVICE_LEVEL), so the client never needs to know which artifact it is.
 */
export interface DownloadableOrder {
  documentId: string;
  canDownload: boolean;
}

export interface DownloadAction {
  visible: boolean;
  href: string | null;
}

export function resolveDownloadAction(entry: DownloadableOrder): DownloadAction {
  if (!entry.canDownload) return { visible: false, href: null };
  return { visible: true, href: `/api/documents/${entry.documentId}/download` };
}
