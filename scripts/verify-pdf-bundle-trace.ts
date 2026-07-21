/**
 * Deployment-level check (2026-07-25): Jest can prove analyzeDocumentForPricing() runs
 * correctly in Node, but it cannot prove Vercel's @vercel/nft file-tracing step actually
 * ships @napi-rs/canvas's native binary inside the deployed function bundle — that crash
 * ("Cannot find module '@napi-rs/canvas'" -> DOMMatrix undefined fallback) only ever showed
 * up in the real .next/server/**\/*.nft.json trace files, never in Jest.
 *
 * Run after a real `next build` (this script does not build itself — see the build:verify
 * script, which chains `next build` then this). Fails loudly if the native binary that
 * pdfjs-dist needs for PDF text-layer extraction is missing from either route group that
 * reaches analyzeDocumentForPricing()'s PDF branch.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROUTES_REQUIRING_CANVAS = [
  'app/api/documents/upload-card/route.js.nft.json',
  'app/api/documents/upload-card/complete/route.js.nft.json',
  'app/api/order-drafts/[draftId]/calculate/route.js.nft.json',
  'app/api/order-drafts/[draftId]/upload/complete/route.js.nft.json',
];

const NATIVE_BINARY_MARKER = '@napi-rs/canvas-linux-x64-gnu/skia.linux-x64-gnu.node';

function main() {
  const serverDir = path.join(process.cwd(), '.next', 'server');
  if (!fs.existsSync(serverDir)) {
    console.error(`verify-pdf-bundle-trace: ${serverDir} does not exist — run "next build" first.`);
    process.exit(1);
  }

  let failed = false;
  for (const relPath of ROUTES_REQUIRING_CANVAS) {
    const tracePath = path.join(serverDir, relPath);
    if (!fs.existsSync(tracePath)) {
      console.error(`verify-pdf-bundle-trace: missing trace file ${relPath} — route may have moved/been renamed.`);
      failed = true;
      continue;
    }
    const trace = JSON.parse(fs.readFileSync(tracePath, 'utf8')) as { files: string[] };
    const hasNativeBinary = trace.files.some((f) => f.includes(NATIVE_BINARY_MARKER));
    if (!hasNativeBinary) {
      console.error(
        `verify-pdf-bundle-trace: FAIL — ${relPath} does not include ${NATIVE_BINARY_MARKER}. ` +
          `This route's deployed function would crash at runtime with "Cannot find module '@napi-rs/canvas'" ` +
          `the moment a PDF reaches analyzeDocumentForPricing(). Check next.config.ts's outputFileTracingIncludes ` +
          `still matches this route's app-path.`,
      );
      failed = true;
    } else {
      console.log(`verify-pdf-bundle-trace: OK — ${relPath} includes the native canvas binary.`);
    }
  }

  if (failed) {
    process.exit(1);
  }
  console.log('verify-pdf-bundle-trace: all routes that reach analyzeDocumentForPricing() include the native canvas binary.');
}

main();
