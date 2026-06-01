import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseServer } from '@/lib/supabase/server';
import { downloadFile } from '@/lib/r2/client';
import { env } from '@/lib/env';
import type { Database } from '@/types';

const PRICE_PER_WORD = 0.01; // USD per word

async function getAuthUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    },
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function ocrWithRetry(pdfBuffer: Buffer): Promise<string> {
  const base64 = pdfBuffer.toString('base64');
  const body = {
    model: 'mistral-ocr-latest',
    document: {
      type: 'document_url',
      document_url: `data:application/pdf;base64,${base64}`,
    },
  };

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
    try {
      const res = await fetch('https://api.mistral.ai/v1/ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.MISTRAL_API_KEY}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Mistral OCR ${res.status}: ${text}`);
      }
      const data = (await res.json()) as { pages: Array<{ markdown: string }> };
      return data.pages.map((p) => p.markdown).join('\n');
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError ?? new Error('OCR failed');
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await getAuthUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { documentId } = (await request.json()) as { documentId?: string };
    if (!documentId) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 });
    }

    const { data: doc } = await supabaseServer
      .from('documents')
      .select('id, user_id, file_key')
      .eq('id', documentId)
      .single();

    if (!doc || doc.user_id !== user.id) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const pdfBuffer = await downloadFile(doc.file_key);
    const markdown = await ocrWithRetry(pdfBuffer);
    const wordCount = countWords(markdown);
    const priceUsd = Math.round(wordCount * PRICE_PER_WORD * 100) / 100;

    return NextResponse.json({ wordCount, priceUsd });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[estimate] error:', err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
