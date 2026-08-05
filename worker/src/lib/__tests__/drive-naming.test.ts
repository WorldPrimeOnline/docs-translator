/**
 * @jest-environment node
 *
 * Tests for the pure Drive-naming helpers used by the 2026-08-01 multi-source
 * per-source rewrite of processJob() — sourceDriveFilename/aiDraftDriveFilename.
 * These live in lib/drive-naming.ts (not processor.ts) specifically so they're
 * importable without pulling in Supabase/env/OCR/etc. — the rest of the rewrite is
 * exercised via the staging E2E scenarios (heavy I/O: Mistral OCR, Puppeteer,
 * Google Drive, Jira — no existing mocking harness for processJob() itself).
 */
import { sourceDriveFilename, aiDraftDriveFilename } from '../drive-naming';

describe('sourceDriveFilename', () => {
  it('zero-pads the sequence to 3 digits and keeps the original filename verbatim', () => {
    expect(sourceDriveFilename(1, 'passport.pdf')).toBe('001_passport.pdf');
    expect(sourceDriveFilename(10, 'visa.jpg')).toBe('010_visa.jpg');
    expect(sourceDriveFilename(123, 'contract.docx')).toBe('123_contract.docx');
  });
});

describe('aiDraftDriveFilename', () => {
  it('zero-pads the sequence and inserts AI_DRAFT before the base name, forcing .docx', () => {
    expect(aiDraftDriveFilename(1, 'passport.pdf')).toBe('001_AI_DRAFT_passport.docx');
    expect(aiDraftDriveFilename(2, 'visa.jpg')).toBe('002_AI_DRAFT_visa.docx');
  });

  it('strips only the final extension, preserving dots in the base name', () => {
    expect(aiDraftDriveFilename(3, 'my.contract.v2.docx')).toBe('003_AI_DRAFT_my.contract.v2.docx');
  });

  it('handles a filename with no extension', () => {
    expect(aiDraftDriveFilename(1, 'noext')).toBe('001_AI_DRAFT_noext.docx');
  });
});
