/**
 * Tests for mergeFileSelection()/removeFileAt()/sortByNaturalFilename() — WO-98
 * multi-file order-preservation audit (2026-08-04, corrected 2026-08-05).
 *
 * The real WO-98 job's job_source_files (read-only DB audit) showed sequence 1..10
 * mapped to original_filename "10.jpg","9.jpg",...,"1.jpg" — a perfect reversal. Every
 * server-side stage was already proven to faithfully preserve array order; the actual
 * bug is that the browser's FileList handed back a non-numeric order in the first
 * place. The fix: normalize each newly incoming batch to natural numeric filename
 * order before it ever enters React state — sequence is assigned later, purely from
 * array position, never touched again.
 */
import { mergeFileSelection, removeFileAt, sortByNaturalFilename } from '../file-selection';

function makeFile(name: string): File {
  return new File(['x'], name, { type: 'image/jpeg' });
}

describe('WO-98 reproduction: a reversed/unstable FileList order is normalized to natural numeric order', () => {
  it('["10.jpg","9.jpg",...,"1.jpg"] from FileList -> display/persistence order ["1.jpg","2.jpg",...,"10.jpg"]', () => {
    const reversedFileList = Array.from({ length: 10 }, (_, i) => makeFile(`${10 - i}.jpg`));
    expect(reversedFileList.map((f) => f.name)).toEqual(['10.jpg', '9.jpg', '8.jpg', '7.jpg', '6.jpg', '5.jpg', '4.jpg', '3.jpg', '2.jpg', '1.jpg']);

    const result = mergeFileSelection([], reversedFileList, false);

    expect(result.map((f) => f.name)).toEqual(['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg', '9.jpg', '10.jpg']);
  });

  it('a fully scrambled (non-monotonic) FileList order is also normalized', () => {
    const scrambled = ['3.jpg', '1.jpg', '10.jpg', '2.jpg', '9.jpg', '4.jpg', '8.jpg', '5.jpg', '7.jpg', '6.jpg'].map(makeFile);
    const result = mergeFileSelection([], scrambled, false);
    expect(result.map((f) => f.name)).toEqual(['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg', '7.jpg', '8.jpg', '9.jpg', '10.jpg']);
  });

  it('IMG_1, IMG_2, IMG_10 style names sort numerically, not lexicographically ("IMG_10" never lands between "IMG_1" and "IMG_2")', () => {
    const files = ['IMG_10.jpg', 'IMG_2.jpg', 'IMG_1.jpg'].map(makeFile);
    const result = mergeFileSelection([], files, false);
    expect(result.map((f) => f.name)).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg']);
  });
});

describe('sortByNaturalFilename', () => {
  it('sorts plain numeric names naturally', () => {
    const files = ['10.jpg', '2.jpg', '1.jpg'].map(makeFile);
    expect(sortByNaturalFilename(files).map((f) => f.name)).toEqual(['1.jpg', '2.jpg', '10.jpg']);
  });

  it('is a stable sort — two files with the IDENTICAL name keep their original relative order', () => {
    const a = makeFile('scan.jpg');
    const b = makeFile('scan.jpg');
    const c = makeFile('scan.jpg');
    expect(sortByNaturalFilename([a, b, c])).toEqual([a, b, c]);
  });

  it('does not mutate the input array', () => {
    const files = ['2.jpg', '1.jpg'].map(makeFile);
    const copy = [...files];
    sortByNaturalFilename(files);
    expect(files).toEqual(copy);
  });
});

describe('mergeFileSelection', () => {
  it('a new batch is appended AFTER the already-selected files, each batch normalized independently', () => {
    const batch1 = ['3.jpg', '1.jpg', '2.jpg'].map(makeFile);
    const batch2 = ['13.jpg', '11.jpg', '12.jpg'].map(makeFile);

    const afterBatch1 = mergeFileSelection([], batch1, false);
    expect(afterBatch1.map((f) => f.name)).toEqual(['1.jpg', '2.jpg', '3.jpg']);

    const afterBatch2 = mergeFileSelection(afterBatch1, batch2, false);
    expect(afterBatch2.map((f) => f.name)).toEqual(['1.jpg', '2.jpg', '3.jpg', '11.jpg', '12.jpg', '13.jpg']);
  });

  it('an already-selected (earlier) batch is never re-sorted by a later addFiles() call', () => {
    // Simulate a customer who manually removed an item from batch 1, producing an
    // order that natural-sort would NOT have produced on its own (3.jpg before 1.jpg).
    const manuallyReordered = [makeFile('3.jpg'), makeFile('1.jpg')];
    const batch2 = [makeFile('2.jpg')];
    const result = mergeFileSelection(manuallyReordered, batch2, false);
    // batch2 is appended AFTER, unsorted-relative-to-batch1 — batch1's own order is untouched.
    expect(result.map((f) => f.name)).toEqual(['3.jpg', '1.jpg', '2.jpg']);
  });

  it('reproduces the exact 10-file WO-98 scenario built from two batches (7 then 3), each batch independently normalized', () => {
    const batch1 = ['7.jpg', '5.jpg', '6.jpg', '3.jpg', '4.jpg', '1.jpg', '2.jpg'].map(makeFile);
    const batch2 = ['10.jpg', '8.jpg', '9.jpg'].map(makeFile);
    const result = mergeFileSelection(mergeFileSelection([], batch1, false), batch2, false);
    expect(result.map((f) => f.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `${i + 1}.jpg`),
    );
  });

  it('after a successful upload (uploadedBatch=true), adding a new file REPLACES the stale selection, still normalized', () => {
    const uploaded = [makeFile('1.jpg')];
    const retry = [makeFile('2.jpg'), makeFile('1.jpg')];
    const result = mergeFileSelection(uploaded, retry, true);
    expect(result.map((f) => f.name)).toEqual(['1.jpg', '2.jpg']);
  });

  it('two files with the identical name are kept as two distinct entries, in their original relative order (stable sort — dedup-by-hash happens server-side, not here)', () => {
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

  it('after removal, the array is already contiguous (0..N-1) — the next /init call derives sequence 1..N with no gaps, no separate renormalization step needed', () => {
    const files = Array.from({ length: 10 }, (_, i) => makeFile(`${i + 1}.jpg`));
    const afterRemoval = removeFileAt(files, 4); // remove "5.jpg" -> 9 files left
    expect(afterRemoval).toHaveLength(9);
    // Simulate what /init does: sequence = array index + 1.
    const sequences = afterRemoval.map((_, i) => i + 1);
    expect(sequences).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
