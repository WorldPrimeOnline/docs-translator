/**
 * Anonymous-safe file upload for a pre-checkout draft.
 * Files land in a temp `draft-uploads/` R2 prefix — never the permanent `documents/`
 * prefix — until the draft is converted into a real order at checkout time.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDraftRow, setDraftFile } from '@/lib/order-drafts/service';
import { getDraftSessionToken } from '@/lib/order-drafts/session';
import { getOptionalAuthUser } from '@/lib/order-drafts/request-context';
import { uploadFile } from '@/lib/r2/client';
import { convertToPdf, mergePdfs } from '@/lib/convert-to-pdf';
import { matchesClaimedMimeType } from '@/lib/file-validation/signature';

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

const ANONYMOUS_MAX_TOTAL_SIZE = 20 * 1024 * 1024;
const AUTHENTICATED_MAX_TOTAL_SIZE = 50 * 1024 * 1024;
const MAX_FILE_SIZE_EACH = 20 * 1024 * 1024;

function detectMimeType(file: File): string {
  if (file.type && ALLOWED_MIME_TYPES[file.type]) return file.type;
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return file.type;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ draftId: string }> }): Promise<NextResponse> {
  try {
    const { draftId } = await params;
    const draft = await getDraftRow(draftId);
    if (!draft) return NextResponse.json({ error: 'DRAFT_NOT_FOUND' }, { status: 404 });

    const [sessionToken, user] = await Promise.all([getDraftSessionToken(), getOptionalAuthUser()]);
    const owner = { sessionToken, userId: user?.id ?? null };
    const owned = draft.user_id ? draft.user_id === owner.userId : draft.anonymous_session_id === owner.sessionToken;
    if (!owned) return NextResponse.json({ error: 'FORBIDDEN' }, { status: 403 });
    if (draft.status === 'converted') return NextResponse.json({ error: 'DRAFT_ALREADY_CONVERTED' }, { status: 409 });

    const formData = await request.formData();
    const rawFiles = formData.getAll('file').filter((f): f is File => f instanceof File);
    if (rawFiles.length === 0) {
      return NextResponse.json({ error: 'At least one file is required' }, { status: 400 });
    }

    const totalCap = user ? AUTHENTICATED_MAX_TOTAL_SIZE : ANONYMOUS_MAX_TOTAL_SIZE;

    for (const f of rawFiles) {
      const mime = detectMimeType(f);
      if (!ALLOWED_MIME_TYPES[mime]) {
        return NextResponse.json({ error: `Unsupported file type: ${f.name}` }, { status: 400 });
      }
      if (f.size > MAX_FILE_SIZE_EACH) {
        return NextResponse.json({ error: `File "${f.name}" exceeds the size limit` }, { status: 400 });
      }
    }

    const totalSize = rawFiles.reduce((s, f) => s + f.size, 0);
    if (totalSize > totalCap) {
      return NextResponse.json({ error: 'TOTAL_SIZE_EXCEEDED' }, { status: 400 });
    }

    const buffers = await Promise.all(rawFiles.map((f) => f.arrayBuffer().then((b) => Buffer.from(b))));
    for (let i = 0; i < rawFiles.length; i++) {
      const mime = detectMimeType(rawFiles[i]!);
      if (!matchesClaimedMimeType(buffers[i]!, mime)) {
        return NextResponse.json({ error: 'INVALID_FILE_SIGNATURE', file: rawFiles[i]!.name }, { status: 400 });
      }
    }

    const pdfParts = await Promise.all(
      rawFiles.map((f, i) => convertToPdf(buffers[i]!, detectMimeType(f))),
    );
    const pdfBuffer = await mergePdfs(pdfParts);

    const firstName = rawFiles[0]!.name.replace(/[^a-zA-Z0-9._\- ]/g, '_').slice(0, 200);
    const originalName = rawFiles.length === 1 ? firstName : `${rawFiles.length}_files_${firstName}`;
    const r2Key = `draft-uploads/${draftId}/original.pdf`;

    await uploadFile(r2Key, pdfBuffer, 'application/pdf');

    const result = await setDraftFile(
      draftId,
      { key: r2Key, originalName, mimeType: 'application/pdf', sizeBytes: pdfBuffer.length },
      owner,
    );

    if (!result.ok) {
      const status = result.error === 'DRAFT_NOT_FOUND' ? 404 : result.error === 'FORBIDDEN' ? 403 : 400;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json({ ok: true, sizeBytes: pdfBuffer.length });
  } catch (err) {
    console.error('[order-drafts] upload failed:', err);
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
