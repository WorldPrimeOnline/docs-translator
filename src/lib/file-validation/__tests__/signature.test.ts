import { detectFileSignature, matchesClaimedMimeType } from '../signature';

describe('detectFileSignature', () => {
  it('detects a PDF by its %PDF- magic bytes', () => {
    const buf = Buffer.from('%PDF-1.7\n%rest of file', 'latin1');
    expect(detectFileSignature(buf)).toBe('pdf');
  });

  it('detects a JPEG by its FF D8 FF magic bytes', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectFileSignature(buf)).toBe('jpeg');
  });

  it('detects a PNG by its 8-byte signature', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(detectFileSignature(buf)).toBe('png');
  });

  it('detects a DOCX (ZIP container) by PK\\x03\\x04', () => {
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(detectFileSignature(buf)).toBe('docx');
  });

  it('detects an empty ZIP archive variant PK\\x05\\x06 as docx-compatible', () => {
    const buf = Buffer.from([0x50, 0x4b, 0x05, 0x06, 0x00, 0x00]);
    expect(detectFileSignature(buf)).toBe('docx');
  });

  it('returns null for an unrecognized/renamed file', () => {
    const buf = Buffer.from('just some plain text content here');
    expect(detectFileSignature(buf)).toBeNull();
  });

  it('returns null for a buffer shorter than 4 bytes', () => {
    expect(detectFileSignature(Buffer.from([0x01, 0x02]))).toBeNull();
  });
});

describe('matchesClaimedMimeType', () => {
  it('accepts a PDF buffer claimed as application/pdf', () => {
    const buf = Buffer.from('%PDF-1.4', 'latin1');
    expect(matchesClaimedMimeType(buf, 'application/pdf')).toBe(true);
  });

  it('rejects a PNG buffer claimed as application/pdf (renamed-extension attack)', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(matchesClaimedMimeType(buf, 'application/pdf')).toBe(false);
  });

  it('rejects a claimed type that does not exist in the kind map', () => {
    const buf = Buffer.from('%PDF-1.4', 'latin1');
    expect(matchesClaimedMimeType(buf, 'text/plain')).toBe(false);
  });

  it('rejects when the signature cannot be detected at all', () => {
    const buf = Buffer.from('not a real file');
    expect(matchesClaimedMimeType(buf, 'application/pdf')).toBe(false);
  });
});
