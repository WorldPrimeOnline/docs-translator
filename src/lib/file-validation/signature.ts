export type DetectedFileKind = 'pdf' | 'jpeg' | 'png' | 'docx';

/**
 * Magic-byte check — used only for the anonymous draft upload endpoint, where the
 * uploader has no account and extension/MIME spoofing is cheaper to attempt.
 * Authenticated upload routes (upload/upload-card) are unchanged and out of scope.
 */
export function detectFileSignature(buffer: Buffer): DetectedFileKind | null {
  if (buffer.length < 4) return null;

  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';

  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return 'png';
  }

  // DOCX is a ZIP container. `PK\x03\x04` (or the empty-archive variant `PK\x05\x06`)
  // is necessary but not sufficient to prove it's a DOCX specifically — good enough as
  // a defense against a renamed non-office file, paired with the extension/MIME check.
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05)) {
    return 'docx';
  }

  return null;
}

const KIND_TO_MIME: Record<DetectedFileKind, string> = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** True when the claimed MIME type is consistent with the file's actual magic bytes. */
export function matchesClaimedMimeType(buffer: Buffer, claimedMimeType: string): boolean {
  const detected = detectFileSignature(buffer);
  if (!detected) return false;
  return KIND_TO_MIME[detected] === claimedMimeType;
}
