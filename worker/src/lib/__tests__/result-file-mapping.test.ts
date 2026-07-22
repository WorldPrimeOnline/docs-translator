/**
 * @jest-environment node
 *
 * Tests for validateResultFileMapping()/parseSequenceRangeFromFilename() — 2026-08-01
 * multi-file fulfillment decision. Covers the exact scenarios the user specified:
 * 1:1 per-source files, a single grouped range file, several grouped files, gaps,
 * overlaps, out-of-range sequences, and the N=1 unprefixed-filename exception.
 */
import { parseSequenceRangeFromFilename, validateResultFileMapping } from '../result-file-mapping';

describe('parseSequenceRangeFromFilename', () => {
  it('parses a single-sequence prefix', () => {
    expect(parseSequenceRangeFromFilename('001_TRANSLATOR_RESULT.pdf')).toEqual({ start: 1, end: 1 });
  });

  it('parses a range prefix', () => {
    expect(parseSequenceRangeFromFilename('001-010_Contract_TRANSLATOR_RESULT.pdf')).toEqual({ start: 1, end: 10 });
  });

  it('parses a mid-range prefix', () => {
    expect(parseSequenceRangeFromFilename('004-010_Part2.pdf')).toEqual({ start: 4, end: 10 });
  });

  it('returns null for a filename with no numeric prefix', () => {
    expect(parseSequenceRangeFromFilename('signed_document.pdf')).toBeNull();
  });

  it('never derives a sequence from filename alphabetical order alone', () => {
    // "10_" without zero-padding is still a valid 3-digit-free prefix match attempt —
    // the regex requires exactly 3 digits, so this must NOT match.
    expect(parseSequenceRangeFromFilename('10_Contract.pdf')).toBeNull();
  });
});

describe('validateResultFileMapping', () => {
  it('2 sources -> 2 individual result files: valid, one group per file', () => {
    const result = validateResultFileMapping(2, [
      { filename: '001_TRANSLATOR_RESULT.pdf' },
      { filename: '002_TRANSLATOR_RESULT.pdf' },
    ]);
    expect(result).toEqual({
      ok: true,
      groups: [
        { filename: '001_TRANSLATOR_RESULT.pdf', sourceSequences: [1] },
        { filename: '002_TRANSLATOR_RESULT.pdf', sourceSequences: [2] },
      ],
    });
  });

  it('10 sources -> 1 grouped range file: valid, one group covering 1..10', () => {
    const result = validateResultFileMapping(10, [{ filename: '001-010_Contract_TRANSLATOR_RESULT.pdf' }]);
    expect(result).toEqual({
      ok: true,
      groups: [{ filename: '001-010_Contract_TRANSLATOR_RESULT.pdf', sourceSequences: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }],
    });
  });

  it('5 sources -> 2 grouped results: valid, no overlap, full coverage', () => {
    const result = validateResultFileMapping(5, [
      { filename: '001-003_Part1.pdf' },
      { filename: '004-005_Part2.pdf' },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.groups.flatMap((g) => g.sourceSequences).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it('1 source, unprefixed filename: allowed exactly because N=1', () => {
    const result = validateResultFileMapping(1, [{ filename: 'signed_document.pdf' }]);
    expect(result).toEqual({ ok: true, groups: [{ filename: 'signed_document.pdf', sourceSequences: [1] }] });
  });

  it('2 sources, unprefixed filename: blocked — ambiguous, must disambiguate', () => {
    const result = validateResultFileMapping(2, [{ filename: 'signed_document.pdf' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/no NNN\/NNN-MMM sequence prefix/);
  });

  it('gap blocks publication: 3 sources but only sequences 1 and 3 covered', () => {
    const result = validateResultFileMapping(3, [
      { filename: '001_TRANSLATOR_RESULT.pdf' },
      { filename: '003_TRANSLATOR_RESULT.pdf' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('sequence(s): 2'))).toBe(true);
  });

  it('overlap blocks publication: two files both claim sequence 2', () => {
    const result = validateResultFileMapping(3, [
      { filename: '001-002_Part1.pdf' },
      { filename: '002-003_Part2.pdf' },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('sequence 2 is covered by multiple files'))).toBe(true);
  });

  it('out-of-range sequence blocks publication: job only has 2 sources but a file claims 001-003', () => {
    const result = validateResultFileMapping(2, [{ filename: '001-003_Contract.pdf' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('exceeds this job\'s 2 source file(s)'))).toBe(true);
  });

  it('the same filename appearing twice in one candidate list is treated as an overlap and blocked, not silently deduped (the actual "retry doesn\'t duplicate" guarantee lives in upsertJobResultFile\'s upsert, not here)', () => {
    const result = validateResultFileMapping(1, [
      { filename: '001_TRANSLATOR_RESULT.pdf' },
      { filename: '001_TRANSLATOR_RESULT.pdf' },
    ]);
    expect(result.ok).toBe(false);
  });
});
