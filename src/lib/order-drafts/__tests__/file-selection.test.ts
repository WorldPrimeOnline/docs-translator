/**
 * Tests for mergeFileSelection()/removeFileAt() — WO-98 multi-file order-preservation
 * audit (2026-08-04): sequence must be assigned once, by the client's visible file
 * order, before any parallel upload starts — never by completion time, created_at,
 * filename, Drive API order, unshift/reverse, or reconstructed after Promise.all
 * without the original index.
 */
import { mergeFileSelection, removeFileAt } from '../file-selection';

function makeFile(name: string): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

describe('mergeFileSelection', () => {
  it('a new batch is appended AFTER the already-selected files, in its own order', () => {
    const batch1 = [makeFile('1.jpg'), makeFile('2.jpg'), makeFile('3.jpg')];
    const batch2 = [makeFile('4.jpg'), makeFile('5.jpg')];

    const afterBatch1 = mergeFileSelection([], batch1, false);
    const afterBatch2 = mergeFileSelection(afterBatch1, batch2, false);

    expect(afterBatch2.map((f) => f.name)).toEqual(['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg']);
  });

  it('reproduces the 10-file WO-98 scenario built from two batches (7 then 3)', () => {
    const batch1 = Array.from({ length: 7 }, (_, i) => makeFile(`${i + 1}.jpg`));
    const batch2 = Array.from({ length: 3 }, (_, i) => makeFile(`${i + 8}.jpg`));
    const result = mergeFileSelection(mergeFileSelection([], batch1, false), batch2, false);
    expect(result.map((f) => f.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `${i + 1}.jpg`),
    );
  });

  it('after a successful upload (uploadedBatch=true), adding a new file REPLACES the stale selection, never appends', () => {
    const uploaded = [makeFile('1.jpg')];
    const retry = [makeFile('retry.jpg')];
    const result = mergeFileSelection(uploaded, retry, true);
    expect(result.map((f) => f.name)).toEqual(['retry.jpg']);
  });

  it('two files with the identical name are kept as two distinct entries, in order (dedup-by-hash happens server-side, not here)', () => {
    const a = makeFile('scan.jpg');
    const b = makeFile('scan.jpg');
    const result = mergeFileSelection([], [a, b], false);
    expect(result).toEqual([a, b]);
  });
});

describe('removeFileAt', () => {
  it('removing one file never reorders the rest', () => {
    const files = Array.from({ length: 10 }, (_, i) => makeFile(`${i + 1}.jpg`));
    const result = removeFileAt(files, 4); // remove "5.jpg"
    expect(result.map((f) => f.name)).toEqual(['1.jpg', '2.jpg', '3.jpg', '4.jpg', '6.jpg', '7.jpg', '8.jpg', '9.jpg', '10.jpg']);
  });

  it('removing the first file shifts nothing out of order', () => {
    const files = [makeFile('1.jpg'), makeFile('2.jpg'), makeFile('3.jpg')];
    expect(removeFileAt(files, 0).map((f) => f.name)).toEqual(['2.jpg', '3.jpg']);
  });

  it('removing the last file leaves the rest untouched', () => {
    const files = [makeFile('1.jpg'), makeFile('2.jpg'), makeFile('3.jpg')];
    expect(removeFileAt(files, 2).map((f) => f.name)).toEqual(['1.jpg', '2.jpg']);
  });
});
