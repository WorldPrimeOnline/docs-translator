import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { processDocument } from '../lib/process-document';
import { runBatch } from '../lib/batch-runner';
import { createLogger } from '../lib/logger';
import type { ManifestEntry } from '../lib/types';

jest.mock('../lib/process-document');

const mockProcessDocument = processDocument as jest.MockedFunction<typeof processDocument>;

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wpo-batch-runner-test-'));
}

function makeEntry(file: string): ManifestEntry {
  return {
    file,
    sourceLanguage: 'ru',
    targetLanguage: 'en',
    documentType: 'passport',
    serviceLevel: 'electronic',
  };
}

function successResult(overrides: Partial<Awaited<ReturnType<typeof processDocument>>> = {}) {
  return {
    status: 'completed' as const,
    errorCode: null,
    errorMessage: null,
    pageCount: 1,
    extractedWordCount: 50,
    warnings: [],
    pricingAmountKzt: 1500,
    pricingVersion: 'v1',
    reconciliationStatus: 'OK',
    translatedDocxPath: '/tmp/x.docx',
    translatedHtmlPath: '/tmp/x.html',
    translatedPdfPath: '/tmp/x.pdf',
    reportJsonPath: '/tmp/report.json',
    reportMdPath: '/tmp/report.md',
    reportHtmlPath: '/tmp/report.html',
    durationSeconds: 1.2,
    ...overrides,
  };
}

function failureResult(errorMessage = 'boom') {
  return {
    status: 'failed' as const,
    errorCode: 'PIPELINE_ERROR',
    errorMessage,
    pageCount: null,
    extractedWordCount: null,
    warnings: [],
    pricingAmountKzt: null,
    pricingVersion: null,
    reconciliationStatus: null,
    translatedDocxPath: null,
    translatedHtmlPath: null,
    translatedPdfPath: null,
    reportJsonPath: null,
    reportMdPath: null,
    reportHtmlPath: null,
    durationSeconds: 0.5,
  };
}

function baseInput(itemsDir: string, inputDir: string, entries: ManifestEntry[], overrides: Record<string, unknown> = {}) {
  return {
    entries,
    inputDir,
    itemsDir,
    environment: 'staging' as const,
    operatorEmail: undefined,
    maxFileMb: 20,
    maxPages: 30,
    dryRunPricingOnly: false,
    skipRender: false,
    keepIntermediate: false,
    saveToR2: false,
    debugFullText: false,
    continueOnError: true,
    skipExisting: false,
    concurrency: 1,
    batchLogger: createLogger(path.join(itemsDir, '..', 'batch.log')),
    ...overrides,
  };
}

beforeEach(() => {
  mockProcessDocument.mockReset();
});

describe('runBatch — output folder structure', () => {
  it('creates one item folder per entry, with source/ocr/translation/rendered/pricing/report/run.log', async () => {
    const inputDir = tmpDir();
    const itemsDir = path.join(tmpDir(), 'items');
    fs.writeFileSync(path.join(inputDir, 'a.pdf'), 'dummy');
    mockProcessDocument.mockResolvedValue(successResult());

    await runBatch(baseInput(itemsDir, inputDir, [makeEntry('a.pdf')]));

    const itemFolders = fs.readdirSync(itemsDir);
    expect(itemFolders).toHaveLength(1);
    const itemDir = path.join(itemsDir, itemFolders[0]!);
    for (const sub of ['source', 'ocr', 'translation', 'rendered', 'pricing', 'report']) {
      expect(fs.existsSync(path.join(itemDir, sub))).toBe(true);
    }
    expect(fs.existsSync(path.join(itemDir, 'run.log'))).toBe(true);
  });

  it('item folder name is safe (no spaces, only index_source_target_type_slug)', async () => {
    const inputDir = tmpDir();
    const itemsDir = path.join(tmpDir(), 'items');
    fs.writeFileSync(path.join(inputDir, '01_ru_kk_identity_card_complex.pdf'), 'dummy');
    mockProcessDocument.mockResolvedValue(successResult());

    const { rows } = await runBatch(baseInput(itemsDir, inputDir, [makeEntry('01_ru_kk_identity_card_complex.pdf')]));

    expect(rows[0]!.itemFolder).toMatch(/^[a-z0-9_]+$/);
    expect(rows[0]!.itemFolder).not.toMatch(/\s/);
  });
});

describe('runBatch — continue-on-error', () => {
  it('a failed item does not stop the batch when continueOnError is true', async () => {
    const inputDir = tmpDir();
    const itemsDir = path.join(tmpDir(), 'items');
    fs.writeFileSync(path.join(inputDir, 'a.pdf'), 'dummy');
    fs.writeFileSync(path.join(inputDir, 'b.pdf'), 'dummy');

    mockProcessDocument.mockResolvedValueOnce(failureResult('first failed'));
    mockProcessDocument.mockResolvedValueOnce(successResult());

    const { rows, stoppedEarly } = await runBatch(
      baseInput(itemsDir, inputDir, [makeEntry('a.pdf'), makeEntry('b.pdf')], { continueOnError: true }),
    );

    expect(stoppedEarly).toBe(false);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.status).toBe('failed');
    expect(rows[1]!.status).toBe('completed');
    expect(mockProcessDocument).toHaveBeenCalledTimes(2);
  });
});

describe('runBatch — stop-on-error', () => {
  it('a failed item stops the batch when continueOnError is false', async () => {
    const inputDir = tmpDir();
    const itemsDir = path.join(tmpDir(), 'items');
    fs.writeFileSync(path.join(inputDir, 'a.pdf'), 'dummy');
    fs.writeFileSync(path.join(inputDir, 'b.pdf'), 'dummy');

    mockProcessDocument.mockResolvedValueOnce(failureResult('stop here'));
    mockProcessDocument.mockResolvedValueOnce(successResult());

    const { rows, stoppedEarly } = await runBatch(
      baseInput(itemsDir, inputDir, [makeEntry('a.pdf'), makeEntry('b.pdf')], { continueOnError: false }),
    );

    expect(stoppedEarly).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('failed');
    expect(mockProcessDocument).toHaveBeenCalledTimes(1);
  });
});

describe('runBatch — a failed item still gets an item folder with an error report/log', () => {
  it('failed item folder exists with run.log even though processDocument failed', async () => {
    const inputDir = tmpDir();
    const itemsDir = path.join(tmpDir(), 'items');
    fs.writeFileSync(path.join(inputDir, 'a.pdf'), 'dummy');
    mockProcessDocument.mockResolvedValue(failureResult('boom'));

    const { rows } = await runBatch(baseInput(itemsDir, inputDir, [makeEntry('a.pdf')]));

    const itemDir = path.join(itemsDir, rows[0]!.itemFolder);
    expect(fs.existsSync(itemDir)).toBe(true);
    expect(fs.existsSync(path.join(itemDir, 'run.log'))).toBe(true);
    expect(rows[0]!.errorCode).toBe('PIPELINE_ERROR');
    expect(rows[0]!.errorMessage).toBe('boom');
  });
});

describe('runBatch — skip-existing', () => {
  it('skips an item whose report already exists, marks status=skipped, and does not call processDocument for it', async () => {
    const inputDir = tmpDir();
    const itemsDir = path.join(tmpDir(), 'items');
    fs.writeFileSync(path.join(inputDir, 'a.pdf'), 'dummy');

    // First run creates the item + its completed report.
    mockProcessDocument.mockResolvedValueOnce(successResult());
    const first = await runBatch(baseInput(itemsDir, inputDir, [makeEntry('a.pdf')]));
    const folderName = first.rows[0]!.itemFolder;
    // processDocument is mocked, so it doesn't actually write the report file — write it manually to simulate a prior completed run.
    fs.mkdirSync(path.join(itemsDir, folderName, 'report'), { recursive: true });
    fs.writeFileSync(path.join(itemsDir, folderName, 'report', 'report.INTERNAL_TEST.json'), '{}');

    mockProcessDocument.mockClear();

    const second = await runBatch(baseInput(itemsDir, inputDir, [makeEntry('a.pdf')], { skipExisting: true }));

    expect(second.rows[0]!.status).toBe('skipped');
    expect(mockProcessDocument).not.toHaveBeenCalled();
  });

  it('does not skip when skipExisting is false, even if a report exists', async () => {
    const inputDir = tmpDir();
    const itemsDir = path.join(tmpDir(), 'items');
    fs.writeFileSync(path.join(inputDir, 'a.pdf'), 'dummy');

    mockProcessDocument.mockResolvedValueOnce(successResult());
    const first = await runBatch(baseInput(itemsDir, inputDir, [makeEntry('a.pdf')]));
    const folderName = first.rows[0]!.itemFolder;
    fs.mkdirSync(path.join(itemsDir, folderName, 'report'), { recursive: true });
    fs.writeFileSync(path.join(itemsDir, folderName, 'report', 'report.INTERNAL_TEST.json'), '{}');

    mockProcessDocument.mockClear();
    mockProcessDocument.mockResolvedValueOnce(successResult());

    const second = await runBatch(baseInput(itemsDir, inputDir, [makeEntry('a.pdf')], { skipExisting: false }));

    expect(second.rows[0]!.status).toBe('completed');
    expect(mockProcessDocument).toHaveBeenCalledTimes(1);
  });
});

describe('runBatch — an unexpected throw from processDocument never crashes the whole batch', () => {
  it('converts a thrown error into a failed row and continues (with continueOnError)', async () => {
    const inputDir = tmpDir();
    const itemsDir = path.join(tmpDir(), 'items');
    fs.writeFileSync(path.join(inputDir, 'a.pdf'), 'dummy');
    fs.writeFileSync(path.join(inputDir, 'b.pdf'), 'dummy');

    mockProcessDocument.mockRejectedValueOnce(new Error('unexpected crash'));
    mockProcessDocument.mockResolvedValueOnce(successResult());

    const { rows } = await runBatch(
      baseInput(itemsDir, inputDir, [makeEntry('a.pdf'), makeEntry('b.pdf')], { continueOnError: true }),
    );

    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.errorMessage).toContain('unexpected crash');
    expect(rows[1]!.status).toBe('completed');
  });
});

describe('runBatch — row field mapping', () => {
  it('maps processDocument fields onto the summary row correctly', async () => {
    const inputDir = tmpDir();
    const itemsDir = path.join(tmpDir(), 'items');
    fs.writeFileSync(path.join(inputDir, 'a.pdf'), 'dummy');
    mockProcessDocument.mockResolvedValue(
      successResult({
        pricingAmountKzt: 4200,
        reconciliationStatus: 'OK',
        translatedDocxPath: '/out/a.docx',
        translatedHtmlPath: '/out/a.html',
        translatedPdfPath: '/out/a.pdf',
        pageCount: 3,
        extractedWordCount: 900,
        warnings: ['w1', 'w2'],
      }),
    );

    const { rows } = await runBatch(baseInput(itemsDir, inputDir, [makeEntry('a.pdf')]));
    const row = rows[0]!;
    expect(row.finalPriceKzt).toBe(4200);
    expect(row.reconciliationStatus).toBe('OK');
    expect(row.outputDocxPath).toBe('/out/a.docx');
    expect(row.outputHtmlPath).toBe('/out/a.html');
    expect(row.outputPdfDiagnosticPath).toBe('/out/a.pdf');
    expect(row.ocrPageCount).toBe(3);
    expect(row.extractedWordCount).toBe(900);
    expect(row.warningsCount).toBe(2);
    expect(row.warnings).toEqual(['w1', 'w2']);
  });
});
