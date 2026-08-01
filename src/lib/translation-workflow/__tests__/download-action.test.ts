/**
 * WO-106 regression: HistoryRow must use the exact same download-visibility/href
 * logic as ActiveOrderCard — see download-action.ts's doc comment. This file locks
 * in the pure decision both components now call.
 */
import { resolveDownloadAction } from '../download-action';

describe('resolveDownloadAction', () => {
  it('canDownload=true → visible, href points at the shared download route', () => {
    const action = resolveDownloadAction({ documentId: 'doc-1', canDownload: true });
    expect(action).toEqual({ visible: true, href: '/api/documents/doc-1/download' });
  });

  it('canDownload=false → not visible, no href (never a false/dead button)', () => {
    const action = resolveDownloadAction({ documentId: 'doc-1', canDownload: false });
    expect(action).toEqual({ visible: false, href: null });
  });

  it('href is keyed off documentId, not jobId or any other identifier', () => {
    const action = resolveDownloadAction({ documentId: 'a903c6fc-5006-4672-b81b-17a161645fe5', canDownload: true });
    expect(action.href).toBe('/api/documents/a903c6fc-5006-4672-b81b-17a161645fe5/download');
  });

  it('two entries with identical canDownload/documentId resolve identically — the guarantee ActiveOrderCard and HistoryRow depend on', () => {
    const entry = { documentId: 'shared-doc', canDownload: true };
    expect(resolveDownloadAction(entry)).toEqual(resolveDownloadAction({ ...entry }));
  });
});
