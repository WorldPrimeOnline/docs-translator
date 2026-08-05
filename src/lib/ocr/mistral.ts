import { env } from '@/lib/env';

interface MistralOcrPage {
  markdown: string;
}

interface MistralOcrResponse {
  pages: MistralOcrPage[];
}

export interface OcrResult {
  markdown: string;
  pageMarkdowns: string[];
  pageCount: number;
}

export interface ExtractTextFromPdfOptions {
  /**
   * Explicit API key, bypassing @/lib/env entirely when provided. @/lib/env's `env` proxy
   * validates its FULL schema (NODE_ENV, R2_*, ANTHROPIC_API_KEY, NEXT_PUBLIC_SUPABASE_*, ...)
   * on first property access — fine for the web app (already has all of it), but wrong for a
   * standalone caller (tools/pricing-cli) that only ever has MISTRAL_API_KEY. Passing this
   * option means `env.MISTRAL_API_KEY` is never touched, so that validation never fires.
   * Omit it (the default) to keep the existing @/lib/env-backed behavior unchanged.
   */
  mistralApiKey?: string;
}

const MISTRAL_OCR_URL = 'https://api.mistral.ai/v1/ocr';
const MAX_RETRIES = 3;
// 2026-07-23 incident: a real staging OCR call took ~4m42s. The 90s-per-attempt cap added the
// same day did bound a single hang, but retrying a TIMEOUT specifically re-created almost the
// exact same number: 90s + 2s backoff + 90s + 4s backoff + 90s ≈ 276s ≈ the reported 4m41.9s.
// A timeout on attempt 1 is provider-side processing time for THIS document, not a transient
// blip — attempt 2 hitting the same wall is the expected outcome, not bad luck, so retrying it
// only stacks two more full timeout windows onto the customer's wait for no real gain (see
// analyze.ts: an OCR failure of any kind already degrades gracefully to page-count-based
// pricing, never blocks the quote). Retries are still worth keeping for genuinely transient
// failures (network blips, 5xx) — those usually fail fast (well under the timeout) and have a
// real chance of succeeding on a second attempt. So: timeout -> fail fast, no retry. HTTP
// error/network error -> keep the existing MAX_RETRIES + backoff.
//
// 2026-07-23 follow-up investigation: 90s was originally picked with no real latency data.
// The one datapoint we have (the incident) is fully explained by 3 stacked timeouts, not by a
// single very-slow-but-legitimate call, so it says nothing about what a safe single-attempt cap
// is. A large multi-page scanned notary packet can legitimately need well over 30s of real OCR
// processing — capping at 25-30s (as a naive "hit the 30s quote target" fix would) would turn a
// slow-but-successful request into a guaranteed failure for exactly that legitimate document
// class. Tightened moderately to 60s (not the full 90s, not down to 25-30s) as a middle ground
// pending real percentile data from the structured logs below; revisit once that data exists.
const OCR_ATTEMPT_TIMEOUT_MS = 60_000;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripImageRefs(markdown: string): string {
  return markdown
    .replace(/!\[[^\]]*\]\([^)]*\)\n?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractTextFromPdf(pdfBuffer: Buffer, options?: ExtractTextFromPdfOptions): Promise<OcrResult> {
  const apiKey = options?.mistralApiKey ?? env.MISTRAL_API_KEY;
  const base64 = pdfBuffer.toString('base64');
  const body = {
    model: 'mistral-ocr-latest',
    document: {
      type: 'document_url',
      document_url: `data:application/pdf;base64,${base64}`,
    },
  };

  let lastError: Error = new Error('OCR failed');

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);

    const attemptStartedAt = Date.now();
    try {
      const response = await fetch(MISTRAL_OCR_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(OCR_ATTEMPT_TIMEOUT_MS),
      });

      const durationMs = Date.now() - attemptStartedAt;

      if (!response.ok) {
        const text = await response.text();
        lastError = new Error(`Mistral OCR error ${response.status}: ${text}`);
        console.log(JSON.stringify({
          scope: 'mistral_ocr', attempt: attempt + 1, maxAttempts: MAX_RETRIES,
          outcome: 'http_error', status: response.status, durationMs,
        }));
        continue;
      }

      const data = (await response.json()) as MistralOcrResponse;
      const pages = data.pages ?? [];
      const pageMarkdowns = pages.map((p) => stripImageRefs(p.markdown));
      const markdown = pageMarkdowns.join('\n\n');

      console.log(JSON.stringify({
        scope: 'mistral_ocr', attempt: attempt + 1, maxAttempts: MAX_RETRIES,
        outcome: 'success', durationMs, pageCount: pages.length,
      }));

      return { markdown, pageMarkdowns, pageCount: pages.length };
    } catch (err) {
      const durationMs = Date.now() - attemptStartedAt;
      const timedOut = err instanceof Error && err.name === 'TimeoutError';
      lastError = timedOut
        ? new Error(`Mistral OCR timed out after ${OCR_ATTEMPT_TIMEOUT_MS}ms`)
        : err instanceof Error ? err : new Error(String(err));
      console.log(JSON.stringify({
        scope: 'mistral_ocr', attempt: attempt + 1, maxAttempts: MAX_RETRIES,
        outcome: timedOut ? 'timeout' : 'network_error', durationMs,
        message: lastError.message,
      }));
      // A timeout is not retried — see the OCR_ATTEMPT_TIMEOUT_MS doc comment above for why
      // (it strongly predicts the same outcome on a retry, at the cost of another full timeout
      // window). Network errors fall through and keep the existing MAX_RETRIES/backoff.
      if (timedOut) throw lastError;
    }
  }

  throw lastError;
}
