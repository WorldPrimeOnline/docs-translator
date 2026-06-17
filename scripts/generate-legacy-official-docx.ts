/**
 * Generates sample DOCX + HTML output for the legacy official pipeline regression fixture.
 * Run: npx tsx scripts/generate-legacy-official-docx.ts
 */
import fs from 'fs';
import path from 'path';
import { renderToDocx } from '../worker/src/lib/docx-renderer';
import { renderToHtml } from '../worker/src/lib/renderer';

const TRANSLATED_FIXTURE = `
# EMPLOYMENT CERTIFICATE

## Organization Information
| Field | Value |
|-------|-------|
| Organization | SML Group LLP |
| BIN | 047291638 |
| Certificate No. | SML-2026-06-17-071 |

## Employee Information
| Field | Value |
|-------|-------|
| Full Name | YUDENOV GLEB ALEXANDROVICH |
| IIN | 201240012345 |
| Passport | N14720583 |

## Employment Information
| Field | Value |
|-------|-------|
| Position | Senior Software Engineer |
| Employment Contract No. | TD-2020/0914-38 |
| Department | Information Technology |

## Salary Information
| Calculation period | Base salary | Bonus | Compensation | Total gross amount | Amount payable |
|--------------------|-------------|-------|--------------|-------------------|----------------|
| March 2026 | 865 000,00 KZT | 95 000,00 KZT | 28 500,00 KZT | 988 500,00 KZT | 801 472,35 KZT |
| April 2026 | 865 000,00 KZT | 0,00 KZT | 28 500,00 KZT | 893 500,00 KZT | 724 618,10 KZT |
| May 2026 | 865 000,00 KZT | 127 500,00 KZT | 34 750,00 KZT | 1 027 250,00 KZT | 832 906,44 KZT |

## Bank Details
| Field | Value |
|-------|-------|
| IIK/IBAN | KZ559876543210123456 |
| BIC/SWIFT | KCJBKZKX |

## Manager
Chief Executive Officer

[round stamp]

[director signature]

Verification code: SML-74-KZ-170626-Q8X5

Manager IIN: 930208450176

---

## Translator

Certified by: WorldPrime Translations LLP

## Document visual elements:
- [round stamp] — official round stamp present
- [director signature] — director signature present
`;

const renderMeta = {
  sourceLang: 'ru',
  targetLang: 'en',
  documentType: 'employment_document',
  translatedAt: new Date().toISOString().split('T')[0] ?? '',
  filename: 'employment_cert.pdf',
};

async function main(): Promise<void> {
  const outDir = path.join(process.cwd(), 'tmp', 'legacy-official-regression');
  fs.mkdirSync(outDir, { recursive: true });

  console.log('Generating DOCX...');
  const docxBuf = await renderToDocx(TRANSLATED_FIXTURE, renderMeta, []);
  const docxPath = path.join(outDir, 'ai_draft.docx');
  fs.writeFileSync(docxPath, docxBuf);
  console.log(`  DOCX: ${docxPath} (${docxBuf.length} bytes)`);

  console.log('Generating HTML preview...');
  const html = await renderToHtml(TRANSLATED_FIXTURE, renderMeta, []);
  const htmlPath = path.join(outDir, 'preview.html');
  fs.writeFileSync(htmlPath, html, 'utf-8');
  console.log(`  HTML: ${htmlPath} (${Buffer.byteLength(html, 'utf-8')} bytes)`);

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
