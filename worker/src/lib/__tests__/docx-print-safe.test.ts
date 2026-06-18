/**
 * Print-safe regression tests for DOCX table borders.
 *
 * Verifies that all semantic tables in generated DOCX files use black borders
 * (w:color="000000") at print-safe sizes (w:sz >= 4), and that the old
 * near-invisible light-gray borders (BBBBBB, size=1) are not present.
 *
 * Tests three fixture types: employment certificate, medical lab report,
 * financial invoice.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { renderToDocx } from '../docx-renderer';
import type { DocxMeta } from '../docx-renderer';

// ── Helper: extract document.xml from DOCX buffer ─────────────────────────────

async function getDocxXml(buf: Buffer): Promise<string> {
  const tmp = path.join(os.tmpdir(), `wpo-print-safe-${Date.now()}.docx`);
  try {
    fs.writeFileSync(tmp, buf);
    return execSync(`unzip -p "${tmp}" "word/document.xml"`).toString();
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

/**
 * Parse all <w:tblBorders> blocks from document.xml.
 * The docx library emits <w:tblBorders> (not <w:tblBdr>) for table border definitions.
 * Returns array of raw XML strings, one per table border definition.
 */
function extractTblBdrBlocks(xml: string): string[] {
  const blocks: string[] = [];
  const re = /<w:tblBorders>([\s\S]*?)<\/w:tblBorders>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1]) blocks.push(m[1]);
  }
  return blocks;
}

const OFFICIAL_META: DocxMeta = {
  sourceLang: 'ru',
  targetLang: 'en',
  documentType: 'employment_document',
  translatedAt: '2026-06-18',
  filename: 'test.pdf',
  serviceLevel: 'official_with_translator_signature_and_provider_stamp',
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

const EMPLOYMENT_CERT = `
# CERTIFICATE OF EMPLOYMENT

## Organization
| Field | Value |
|---|---|
| Organization | SML Group LLP |
| BIN | 047291638 |
| Certificate No. | SML-2026-06-18-001 |

## Employee
| Field | Value |
|---|---|
| Full Name | YUDENOV GLEB ALEXANDROVICH |
| IIN | 201240012345 |
| Position | Senior Software Engineer |
| Department | Information Technology |

## Salary
| Period | Base | Bonus | Total |
|---|---|---|---|
| March 2026 | 865 000 KZT | 95 000 KZT | 988 500 KZT |
| April 2026 | 865 000 KZT | 0 KZT | 893 500 KZT |

## Visual elements

| Page | Element | Position | Representation |
|---|---|---|---|
| 1 | Stamp/Seal | lower_right | [round stamp] |
| 1 | Signature | lower_left | [director signature] |
`;

const MEDICAL_LAB_REPORT = `
# LABORATORY TEST REPORT

## Patient Information
| Parameter | Value |
|---|---|
| Patient | SMITH JOHN WILLIAM |
| Date of Birth | 15.03.1985 |
| Test Date | 18.06.2026 |
| Lab No. | LAB-2026-001234 |

## Haematology Results
| Test | Result | Reference Range | Status |
|---|---|---|---|
| Haemoglobin | 14.2 g/dL | 13.5–17.5 g/dL | Normal |
| Erythrocytes | 4.85 × 10¹²/L | 4.50–5.50 × 10¹²/L | Normal |
| Leukocytes | 6.8 × 10⁹/L | 4.0–10.0 × 10⁹/L | Normal |
| Platelets | 235 × 10⁹/L | 150–400 × 10⁹/L | Normal |
| ESR | 8 mm/h | 2–15 mm/h | Normal |

## Visual elements

| Page | Element | Position | Representation |
|---|---|---|---|
| 1 | Logo | header | [laboratory logo] |
| 1 | Accreditation mark | upper_right | [ILAC-MRA accreditation mark] |
| 1 | Electronic approval | footer | [electronic approval stamp] |
`;

const FINANCIAL_INVOICE = `
# TAX INVOICE

## Seller
| Field | Value |
|---|---|
| Company | Thai Supplies Co., Ltd. |
| Tax ID | 0105545000123 |
| Invoice No. | INV-2026-0456 |
| Invoice Date | 18.06.2026 |

## Line Items
| No. | Description | Quantity | Unit Price (THB) | Amount (THB) | VAT 7% (THB) |
|---|---|---|---|---|---|
| 1 | Office Supplies Package | 10 | 1 200.00 | 12 000.00 | 840.00 |
| 2 | Printer Cartridge Set | 5 | 2 400.00 | 12 000.00 | 840.00 |
| 3 | Paper A4 (500 sheets) | 20 | 185.00 | 3 700.00 | 259.00 |

## Totals
| Description | Amount (THB) |
|---|---|
| Subtotal | 27 700.00 |
| VAT 7% | 1 939.00 |
| Total | 29 639.00 |
`;

// ── XML assertions ────────────────────────────────────────────────────────────

function assertPrintSafeBorders(xml: string, fixtureName: string): void {
  // blocks = inner content of each <w:tblBorders>…</w:tblBorders> element
  const blocks = extractTblBdrBlocks(xml);
  expect(blocks.length).toBeGreaterThan(0);

  for (const block of blocks) {
    // Must not contain the old light-gray color
    expect(block).not.toContain('BBBBBB');

    // All w:color attrs inside must be black
    const colors = [...block.matchAll(/w:color="([A-Fa-f0-9]+)"/g)].map(m => m[1]!.toUpperCase());
    expect(colors.length).toBeGreaterThan(0);
    for (const color of colors) {
      expect(color).toBe('000000');
    }

    // All w:sz attrs must be >= 4 (0.5pt)
    const sizes = [...block.matchAll(/w:sz="(\d+)"/g)].map(m => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    for (const sz of sizes) {
      expect(sz).toBeGreaterThanOrEqual(4);
    }

    // All w:val attrs must be "single" (not none/dashed/dotted)
    const styles = [...block.matchAll(/w:val="([^"]+)"/g)].map(m => m[1]);
    for (const style of styles) {
      expect(style).toBe('single');
    }

    // Outer border sizes (top/left/bottom/right) must be >= 6 (0.75pt)
    // Self-closing elements: <w:top w:val="single" w:color="000000" w:sz="6"/>
    for (const outerName of ['top', 'left', 'bottom', 'right']) {
      const re = new RegExp(`<w:${outerName}\\s[^>]*/>`);
      const m = block.match(re);
      if (m) {
        const szM = m[0].match(/w:sz="(\d+)"/);
        if (szM) {
          expect(Number(szM[1])).toBeGreaterThanOrEqual(6);
        }
      }
    }

    // Inner border sizes (insideH/insideV) must be >= 4 (0.5pt)
    for (const innerName of ['insideH', 'insideV']) {
      const re = new RegExp(`<w:${innerName}\\s[^>]*/>`);
      const m = block.match(re);
      if (m) {
        const szM = m[0].match(/w:sz="(\d+)"/);
        if (szM) {
          expect(Number(szM[1])).toBeGreaterThanOrEqual(4);
        }
      }
    }
  }

  void fixtureName;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('DOCX print-safe table borders', () => {
  describe('employment certificate', () => {
    let xml: string;

    beforeAll(async () => {
      const buf = await renderToDocx(EMPLOYMENT_CERT, { ...OFFICIAL_META, documentType: 'employment_document' });
      xml = await getDocxXml(buf);
    });

    it('document.xml contains table border blocks', () => {
      expect(extractTblBdrBlocks(xml).length).toBeGreaterThan(0);
    });

    it('no BBBBBB border color anywhere in document.xml', () => {
      expect(extractTblBdrBlocks(xml).join('')).not.toContain('BBBBBB');
    });

    it('all table borders are black (000000) with size >= 4', () => {
      assertPrintSafeBorders(xml, 'employment_cert');
    });

    it('certification table (translator/provider) uses print-safe borders', () => {
      // The cert block is always appended for official serviceLevel
      const tblBdrBlocks = extractTblBdrBlocks(xml);
      // All blocks checked — cert table is included
      expect(tblBdrBlocks.length).toBeGreaterThanOrEqual(3); // KV + salary + cert tables
      for (const block of tblBdrBlocks) {
        expect(block).not.toContain('BBBBBB');
      }
    });
  });

  describe('medical laboratory report', () => {
    let xml: string;

    beforeAll(async () => {
      const buf = await renderToDocx(MEDICAL_LAB_REPORT, { ...OFFICIAL_META, documentType: 'medical_document' });
      xml = await getDocxXml(buf);
    });

    it('no BBBBBB border color', () => {
      expect(extractTblBdrBlocks(xml).join('')).not.toContain('BBBBBB');
    });

    it('all table borders are print-safe', () => {
      assertPrintSafeBorders(xml, 'medical_lab_report');
    });

    it('visual-elements table uses print-safe borders', () => {
      // Visual elements table is the last table, generated by ensureVisualElementsBlock
      const blocks = extractTblBdrBlocks(xml);
      for (const block of blocks) {
        expect(block).not.toContain('BBBBBB');
        expect(block).toContain('000000');
      }
    });
  });

  describe('financial invoice with wide line-item table', () => {
    let xml: string;

    beforeAll(async () => {
      const buf = await renderToDocx(FINANCIAL_INVOICE, { ...OFFICIAL_META, documentType: 'contract' });
      xml = await getDocxXml(buf);
    });

    it('no BBBBBB border color', () => {
      expect(extractTblBdrBlocks(xml).join('')).not.toContain('BBBBBB');
    });

    it('all table borders are print-safe (including wide landscape table)', () => {
      assertPrintSafeBorders(xml, 'financial_invoice');
    });
  });

  describe('electronic (non-official) translation also uses print-safe borders', () => {
    let xml: string;

    beforeAll(async () => {
      const electronicMeta: DocxMeta = {
        ...OFFICIAL_META,
        serviceLevel: 'electronic',
        documentType: 'other',
      };
      const buf = await renderToDocx(EMPLOYMENT_CERT, electronicMeta);
      xml = await getDocxXml(buf);
    });

    it('no BBBBBB border color for electronic service level', () => {
      const blocks = extractTblBdrBlocks(xml);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(block).not.toContain('BBBBBB');
      }
    });
  });
});
