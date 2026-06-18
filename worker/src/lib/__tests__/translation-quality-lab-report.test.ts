/**
 * Golden regression fixture — Thai → Russian medical laboratory report.
 *
 * Tests translation quality gate behavior on a sanitized lab report
 * matching the structure of the real regression source (Thai company header,
 * patient metadata, multi-column lab results table, reference ranges table,
 * long Thai paragraph near end, visual elements).
 *
 * These tests do NOT make live API calls. They test:
 * 1. Quality gate metrics on the "good" baseline translation
 * 2. Quality gate detects all expected issues in the "bad" regression
 * 3. Retry prompt is specific and complete
 * 4. Best-result selection chooses the better translation
 * 5. Underlying helpers: table shape extraction, source-script detection
 */

import {
  runTranslationQualityGate,
  buildQualityRetryPrompt,
  selectBestTranslation,
  formatQualityLogLine,
  extractCertificationIdentifiers,
  type TranslationQualityIssue,
} from '../translation-quality-gate';
import { extractMarkdownTableShapes } from '../table-shape';

// ── Source fixture (sanitized Thai lab report OCR markdown) ───────────────────

const SOURCE_MARKDOWN = `# LABORATORY REPORT

## Company / ห้องปฏิบัติการ

Bangkok Sample Lab Co., Ltd. (บริษัท ตัวอย่าง แล็บ จำกัด)
73 (Sample Rd 3), Lat Phrao 110, Wangthonglang, Bangkok 10310
Tel: 0-2100-0000 Fax: 0-2100-0001

Registration: 2605151199

## Patient Information / ข้อมูลผู้ป่วย

ชื่อผู้ป่วย: Mr. Test Patient
HN: 6905154803
อายุ: 24 ปี
เพศ: ชาย
โรงพยาบาล/คลินิก: เมืองวอยเล็บ
วันที่เก็บตัวอย่าง: 11-05-2026 14:33
วันที่รับตัวอย่าง: 15-05-2026 12:48

## Laboratory Results / ผลการตรวจ

| Test | Sample | Method | Result | Unit | Reference Range |
|---|---|---|---|---|---|
| #Estradiol (E2) | Serum | CMIA | 31.5 | pg/mL | 11.0 – 44.0 |
| #FSH | Serum | CMIA | 2.88 | mIU/mL | 0.95 – 11.95 |
| #LH | Serum | CMIA | 4.07 | mIU/mL | 0.57 – 12.07 |
| #Prolactin | Serum | CMIA | H 40.00 | ng/mL | 3.46 – 19.40 |

## Reference Ranges / ช่วงอ้างอิง

| Test | Unit | Male | Follicular | Ovulation | Luteal | Postmeno |
|---|---|---|---|---|---|---|
| Estradiol | pg/mL | 11–44 | 21–251 | 38–649 | 21–312 | <10–28 |
| FSH | mIU/mL | 0.95–11.95 | 3.03–8.08 | 2.55–16.69 | 1.38–5.47 | 26.72–133.41 |
| LH | mIU/mL | 0.57–12.07 | 1.80–11.79 | 7.59–89.08 | 0.56–14.00 | 5.16–61.99 |

## Comments / ความเห็น

ในกรณีที่ต้องการค่าความไม่แน่นอนขยายของการทดสอบในโปรแกรมมาตรฐานที่แตกต่างจากค่าอ้างอิงมาตรฐาน กรุณาติดต่อห้องปฏิบัติการ Bangkok Sample Lab Co., Ltd.

## Report Details / รายละเอียดรายงาน

Reported by: SAMPLE REPORTER (MT.00001) — Analyst — 15-05-2026 13:44
Approved by: SAMPLE APPROVER (MT.00002) — Lab Supervisor — 15-05-2026 14:14

H = Above reference range. L = Below reference range. # = ISO 15189 accredited test.

## Description of non-text elements in the original

| Page | Element | Position | Representation |
|---|---|---|---|
| 1 | Logo | upper_left | Bangkok Sample Lab |
| 1 | Barcode | upper_left | 2605151199 |
| 1 | Accreditation mark | upper_right | ILAC-MRA |
`;

// ── Good translation fixture (correct) ───────────────────────────────────────

const GOOD_TRANSLATION = `# ПЕРЕВОД С ТАЙСКОГО ЯЗЫКА НА РУССКИЙ ЯЗЫК

# ЛАБОРАТОРНЫЙ ОТЧЁТ

## Компания

Бангкок Сэмпл Лаб Ко., Лтд. (Bangkok Sample Lab Co., Ltd.)
73 (ул. Сэмпл, 3), Лат Пхрао 110, Вангтхонгланг, г. Бангкок 10310
Тел.: 0-2100-0000, факс: 0-2100-0001

Регистрационный номер: 2605151199

## Данные пациента

| Параметр | Значение |
|---|---|
| Имя пациента | Мистер Тест Пэйшент (Mr. Test Patient) |
| Номер истории болезни (HN) | 6905154803 |
| Возраст | 24 года |
| Пол | Мужской (Male) |
| Больница/клиника | Мыанг Войлеб (เมืองวอยเล็บ) |
| Дата/время взятия биоматериала | 11-05-2026 14:33 |
| Дата/время получения | 15-05-2026 12:48 |

## Результаты лабораторного исследования

| Исследование | Биоматериал | Метод | Результат | Единица измерения | Референтные значения |
|---|---|---|---|---|---|
| #Эстрадиол (E2) | Сыворотка крови | CMIA | 31.5 | pg/mL | 11.0 – 44.0 |
| #ФСГ (FSH) | Сыворотка крови | CMIA | 2.88 | mIU/mL | 0.95 – 11.95 |
| #ЛГ (LH) | Сыворотка крови | CMIA | 4.07 | mIU/mL | 0.57 – 12.07 |
| #Пролактин (Prolactin) | Сыворотка крови | CMIA | В 40.00 | ng/mL | 3.46 – 19.40 |

## Референтные значения гормонов

| Исследование | Единица измерения | Мужчины | Фолликулярная | Овуляция | Лютеиновая | Постменопауза |
|---|---|---|---|---|---|---|
| Эстрадиол | pg/mL | 11–44 | 21–251 | 38–649 | 21–312 | <10–28 |
| ФСГ (FSH) | mIU/mL | 0.95–11.95 | 3.03–8.08 | 2.55–16.69 | 1.38–5.47 | 26.72–133.41 |
| ЛГ (LH) | mIU/mL | 0.57–12.07 | 1.80–11.79 | 7.59–89.08 | 0.56–14.00 | 5.16–61.99 |

## Комментарий

Если необходимы расширенные значения неопределённости для тестов, отличных от стандартных референтных значений, обращайтесь в лабораторию Бангкок Сэмпл Лаб Ко., Лтд.

## Сведения об отчёте

Оформил: SAMPLE REPORTER (MT.00001) — Аналитик — 15-05-2026 13:44
Утвердил: SAMPLE APPROVER (MT.00002) — Руководитель лаборатории — 15-05-2026 14:14

В — выше референтных значений. Н — ниже референтных значений. # — исследования, аккредитованные по ISO 15189.

## Описание нетекстовых элементов оригинала

| Страница | Элемент | Расположение | Передача в переводе |
|---|---|---|---|
| 1 | Логотип | верхний левый | Bangkok Sample Lab |
| 1 | Штрих-код | верхний левый | 2605151199 |
| 1 | Знак аккредитации | верхний правый | ILAC-MRA |
`;

// ── Bad translation fixture (regression) ─────────────────────────────────────

const BAD_TRANSLATION = `# ПЕРЕВОД С ТАЙСКОГО ЯЗЫКА НА РУССКИЙ ЯЗЫК

Page: 1 / 1

BRIA บริษัท ตัวอย่าง แล็บ จำกัด Bangkok Sample Lab Co., Ltd.
73 (ตัวอย่าง 3) ลาดพร้าว 110 วังทองหลาง กทม. 10310

2605151199

Имя: Mr. Test Patient
HN: 6905154803
Возраст: 24 года
Пол: Мужской
Больница/Клиника: เมืองวอยเล็บ
Дата забора: 11-05-2026 14:33
Дата получения: 15-05-2026 12:48

## ЛАБОРАТОРНЫЙ ОТЧЁТ

| Тест | Образец | Метод | Результат | Единица | Референс |
|---|---|---|---|---|---|
| #Эстрадиол (E2) | Сыворотка | CMIA | 31.5 | pg/mL | 11.0 – 44.0 |
| #ФСГ | Сыворотка | CMIA | 2.88 | mIU/mL | 0.95 – 11.95 |
| #ЛГ | Сыворотка | CMIA | 4.07 | mIU/mL | 0.57 – 12.07 |
| #Пролактин | Сыворотка | CMIA | H 40.00 | ng/mL | 3.46 – 19.40 |

## Референсные значения

| Тест | Единица | Мужчины | Фолликулярная | Овуляция | Лютеиновая | Постменопауза |
|---|---|---|---|---|---|---|
| Эстрадиол | pg/mL | 11–44 | 21–251 | 38–649 | 21–312 | <10–28 |
| ФСГ | mIU/mL | 0.95–11.95 | 3.03–8.08 | 2.55–16.69 | 1.38–5.47 | 26.72–133.41 |
| ЛГ | mIU/mL | 0.57–12.07 | 1.80–11.79 | 7.59–89.08 | 0.56–14.00 | 5.16–61.99 |

ในกรณีที่ต้องการค่าความไม่แน่นอนขยายของการทดสอบในโปรแกรมมาตรฐานที่แตกต่างจากค่าอ้างอิงมาตรฐาน กรุณาติดต่อห้องปฏิบัติการ Bangkok Sample Lab Co., Ltd.

Reported: SAMPLE REPORTER (MT.00001) 15-05-2026 13:44
Approved: SAMPLE APPROVER (MT.00002) 15-05-2026 14:14

## Описание нетекстовых элементов оригинала

| Страница | Элемент | Расположение | Передача в переводе |
|---|---|---|---|
| 1 | Логотип | верхний левый | Bangkok Sample Lab |
| 1 | Штрих-код | верхний левый | 2605151199 |
| 1 | Знак аккредитации | верхний правый | ILAC-MRA |
`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Translation quality gate — Thai→Russian lab report', () => {

  describe('Good translation baseline — quality gate should pass', () => {
    let result: ReturnType<typeof runTranslationQualityGate>;

    beforeAll(() => {
      result = runTranslationQualityGate({
        sourceMarkdown: SOURCE_MARKDOWN,
        translatedMarkdown: GOOD_TRANSLATION,
        sourceLang: 'th',
        targetLang: 'ru',
      });
    });

    it('has no retry_required issues', () => {
      const retryIssues = result.issues.filter(i => i.severity === 'retry_required');
      expect(retryIssues).toHaveLength(0);
    });

    it('source-script residue ratio is below threshold', () => {
      expect(result.metrics.remainingSourceScriptRatio).toBeLessThan(0.02);
    });

    it('table count is preserved', () => {
      // Source: lab results (6-col) + reference (7-col) + visual elements (4-col) = 3
      // Good translation: patient metadata (2-col) + lab (6-col) + reference (7-col) + visual (4-col) = 4
      expect(result.metrics.translatedTableCount).toBeGreaterThanOrEqual(
        result.metrics.sourceTableCount,
      );
    });

    it('patient metadata table has 2 columns', () => {
      const shapes = extractMarkdownTableShapes(GOOD_TRANSLATION);
      const metadataTable = shapes.find(s => s.columnCount === 2 && s.dataRowCount >= 4);
      expect(metadataTable).toBeDefined();
      expect(metadataTable!.columnCount).toBe(2);
      expect(metadataTable!.dataRowCount).toBeGreaterThanOrEqual(5);
    });

    it('section coverage is high', () => {
      expect(result.metrics.sectionCoverageRatio).toBeGreaterThanOrEqual(0.6);
    });

    it('no flat KV blocks — metadata is in a table', () => {
      const flatKvIssue = result.issues.find(i => i.code === 'METADATA_STRUCTURE_LOST');
      expect(flatKvIssue).toBeUndefined();
    });

    it('no page marker before title issue', () => {
      const pageIssue = result.issues.find(i => i.code === 'SOURCE_PAGE_MARKER_BEFORE_TITLE');
      expect(pageIssue).toBeUndefined();
    });
  });

  describe('Bad translation regression — quality gate should detect all issues', () => {
    let result: ReturnType<typeof runTranslationQualityGate>;

    beforeAll(() => {
      result = runTranslationQualityGate({
        sourceMarkdown: SOURCE_MARKDOWN,
        translatedMarkdown: BAD_TRANSLATION,
        sourceLang: 'th',
        targetLang: 'ru',
      });
    });

    it('hasRetryRequired is true', () => {
      expect(result.hasRetryRequired).toBe(true);
    });

    it('detects SOURCE_PAGE_MARKER_BEFORE_TITLE', () => {
      const issue = result.issues.find(i => i.code === 'SOURCE_PAGE_MARKER_BEFORE_TITLE');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('retry_required');
    });

    it('detects METADATA_STRUCTURE_LOST (patient info as flat KV text)', () => {
      const issue = result.issues.find(i => i.code === 'METADATA_STRUCTURE_LOST');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('retry_required');
    });

    it('detects SOURCE_SCRIPT_REMAINS (untranslated Thai paragraph)', () => {
      const issue = result.issues.find(i => i.code === 'SOURCE_SCRIPT_REMAINS');
      expect(issue).toBeDefined();
      expect(issue!.severity).toBe('retry_required');
    });

    it('remaining Thai ratio exceeds threshold', () => {
      // The bad translation has a full Thai paragraph ≥ 40 chars
      expect(result.metrics.remainingSourceScriptRatio).toBeGreaterThan(0.02);
    });
  });

  describe('Table structure', () => {
    it('source has the expected lab results table (6 columns)', () => {
      const shapes = extractMarkdownTableShapes(SOURCE_MARKDOWN);
      const labTable = shapes.find(s => s.columnCount === 6 && s.dataRowCount >= 4);
      expect(labTable).toBeDefined();
    });

    it('good translation preserves 6-column lab results table', () => {
      const shapes = extractMarkdownTableShapes(GOOD_TRANSLATION);
      const labTable = shapes.find(s => s.columnCount === 6 && s.dataRowCount >= 4);
      expect(labTable).toBeDefined();
    });

    it('good translation has a 2-column patient metadata table', () => {
      const shapes = extractMarkdownTableShapes(GOOD_TRANSLATION);
      const metaTable = shapes.find(s => s.columnCount === 2 && s.dataRowCount >= 5);
      expect(metaTable).toBeDefined();
      expect(metaTable!.columnCount).toBe(2);
      expect(metaTable!.dataRowCount).toBeGreaterThanOrEqual(5);
    });

    it('bad translation has no patient metadata table (table count differs)', () => {
      const goodShapes = extractMarkdownTableShapes(GOOD_TRANSLATION);
      const badShapes = extractMarkdownTableShapes(BAD_TRANSLATION);
      // Good has patient metadata table, bad does not — good should have more tables
      const good2col = goodShapes.filter(s => s.columnCount === 2).length;
      const bad2col = badShapes.filter(s => s.columnCount === 2).length;
      expect(good2col).toBeGreaterThan(bad2col);
    });
  });

  describe('Retry prompt', () => {
    it('retry prompt lists all issues', () => {
      const { issues, metrics } = runTranslationQualityGate({
        sourceMarkdown: SOURCE_MARKDOWN,
        translatedMarkdown: BAD_TRANSLATION,
        sourceLang: 'th',
        targetLang: 'ru',
      });
      const prompt = buildQualityRetryPrompt(issues, metrics);
      expect(prompt).toContain('Required corrections:');
      // Should mention page marker fix
      expect(prompt).toContain('page marker');
      // Should mention table/metadata fix
      expect(prompt).toContain('Markdown table');
      // Should mention source language
      expect(prompt).toContain('source-language content');
    });

    it('retry prompt is not generic ("Try again")', () => {
      const { issues, metrics } = runTranslationQualityGate({
        sourceMarkdown: SOURCE_MARKDOWN,
        translatedMarkdown: BAD_TRANSLATION,
        sourceLang: 'th',
        targetLang: 'ru',
      });
      const prompt = buildQualityRetryPrompt(issues, metrics);
      expect(prompt).not.toBe('Try again');
      // Must have specific issue codes addressed
      expect(prompt.length).toBeGreaterThan(100);
    });
  });

  describe('Best-result selection', () => {
    it('selects good translation over bad', () => {
      const goodResult = runTranslationQualityGate({
        sourceMarkdown: SOURCE_MARKDOWN,
        translatedMarkdown: GOOD_TRANSLATION,
        sourceLang: 'th',
        targetLang: 'ru',
      });
      const badResult = runTranslationQualityGate({
        sourceMarkdown: SOURCE_MARKDOWN,
        translatedMarkdown: BAD_TRANSLATION,
        sourceLang: 'th',
        targetLang: 'ru',
      });

      const best = selectBestTranslation(
        { markdown: BAD_TRANSLATION, result: badResult },
        { markdown: GOOD_TRANSLATION, result: goodResult },
      );
      expect(best.selectedFrom).toBe('retry');
      expect(best.markdown).toBe(GOOD_TRANSLATION);
    });

    it('does not automatically use retry if initial is better', () => {
      const goodResult = runTranslationQualityGate({
        sourceMarkdown: SOURCE_MARKDOWN,
        translatedMarkdown: GOOD_TRANSLATION,
        sourceLang: 'th',
        targetLang: 'ru',
      });
      const badResult = runTranslationQualityGate({
        sourceMarkdown: SOURCE_MARKDOWN,
        translatedMarkdown: BAD_TRANSLATION,
        sourceLang: 'th',
        targetLang: 'ru',
      });

      const best = selectBestTranslation(
        { markdown: GOOD_TRANSLATION, result: goodResult },
        { markdown: BAD_TRANSLATION, result: badResult },
      );
      expect(best.selectedFrom).toBe('initial');
      expect(best.markdown).toBe(GOOD_TRANSLATION);
    });
  });

  describe('Quality log line', () => {
    it('formats all required fields', () => {
      const { issues, metrics } = runTranslationQualityGate({
        sourceMarkdown: SOURCE_MARKDOWN,
        translatedMarkdown: BAD_TRANSLATION,
        sourceLang: 'th',
        targetLang: 'ru',
      });
      const log = formatQualityLogLine(metrics, issues, { retryUsed: true, selectedResult: 'retry' });
      expect(log).toContain('src_tables=');
      expect(log).toContain('tr_tables=');
      expect(log).toContain('src_script_ratio=');
      expect(log).toContain('section_coverage=');
      expect(log).toContain('pv_coverage=');
      expect(log).toContain('retry=true');
      expect(log).toContain('selected=retry');
    });
  });
});

// ── Table structural matching regression ──────────────────────────────────────

describe('Table structural matching — extra metadata table + damaged source table', () => {
  // Regression: translation adds an extra 2-column metadata table AND damages
  // one of the source data tables (drops a column). The quality gate must detect
  // the damaged table even though table counts differ.
  const SOURCE_TWO_TABLES = `
## Data Table A

| Col1 | Col2 | Col3 | Col4 | Col5 | Col6 |
|---|---|---|---|---|---|
| a1 | a2 | a3 | a4 | a5 | a6 |
| b1 | b2 | b3 | b4 | b5 | b6 |
| c1 | c2 | c3 | c4 | c5 | c6 |
| d1 | d2 | d3 | d4 | d5 | d6 |

## Reference Table B

| H1 | H2 | H3 | H4 | H5 | H6 | H7 | H8 | H9 | H10 | H11 | H12 | H13 | H14 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| v1 | v2 | v3 | v4 | v5 | v6 | v7 | v8 | v9 | v10 | v11 | v12 | v13 | v14 |
| w1 | w2 | w3 | w4 | w5 | w6 | w7 | w8 | w9 | w10 | w11 | w12 | w13 | w14 |
| x1 | x2 | x3 | x4 | x5 | x6 | x7 | x8 | x9 | x10 | x11 | x12 | x13 | x14 |
`;

  // Translation: extra 2-col metadata table + Table A (intact) + Table B (damaged: 13 cols)
  const TRANSLATION_EXTRA_META_DAMAGED_B = `
## Patient Data

| Parameter | Value |
|---|---|
| Name | John Doe |
| ID | 12345 |
| Date | 2026-06-17 |

## Data Table A

| Кол1 | Кол2 | Кол3 | Кол4 | Кол5 | Кол6 |
|---|---|---|---|---|---|
| a1 | a2 | a3 | a4 | a5 | a6 |
| b1 | b2 | b3 | b4 | b5 | b6 |
| c1 | c2 | c3 | c4 | c5 | c6 |
| d1 | d2 | d3 | d4 | d5 | d6 |

## Reference Table B (damaged — 13 cols instead of 14)

| Х1 | Х2 | Х3 | Х4 | Х5 | Х6 | Х7 | Х8 | Х9 | Х10 | Х11 | Х12 | Х13 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| v1 | v2 | v3 | v4 | v5 | v6 | v7 | v8 | v9 | v10 | v11 | v12 | v13 |
| w1 | w2 | w3 | w4 | w5 | w6 | w7 | w8 | w9 | w10 | w11 | w12 | w13 |
| x1 | x2 | x3 | x4 | x5 | x6 | x7 | x8 | x9 | x10 | x11 | x12 | x13 |
`;

  it('detects TABLE_SHAPE_CHANGED for damaged 14→13 column table', () => {
    const result = runTranslationQualityGate({
      sourceMarkdown: SOURCE_TWO_TABLES,
      translatedMarkdown: TRANSLATION_EXTRA_META_DAMAGED_B,
      sourceLang: 'en',
      targetLang: 'ru',
    });
    const shapeIssue = result.issues.find(i => i.code === 'TABLE_SHAPE_CHANGED');
    expect(shapeIssue).toBeDefined();
    expect(shapeIssue!.details).toContain('14');
    expect(shapeIssue!.details).toContain('13');
  });

  it('does NOT flag TABLE_SHAPE_CHANGED for intact Table A (6 cols preserved)', () => {
    const result = runTranslationQualityGate({
      sourceMarkdown: SOURCE_TWO_TABLES,
      translatedMarkdown: TRANSLATION_EXTRA_META_DAMAGED_B,
      sourceLang: 'en',
      targetLang: 'ru',
    });
    const shapeIssues = result.issues.filter(i => i.code === 'TABLE_SHAPE_CHANGED');
    // Only Table B should be flagged, not Table A
    expect(shapeIssues.length).toBe(1);
    expect(shapeIssues[0]!.details).not.toContain('6×');
  });

  it('retry prompt mentions 14 columns for damaged table', () => {
    const { issues, metrics } = runTranslationQualityGate({
      sourceMarkdown: SOURCE_TWO_TABLES,
      translatedMarkdown: TRANSLATION_EXTRA_META_DAMAGED_B,
      sourceLang: 'en',
      targetLang: 'ru',
    });
    const prompt = buildQualityRetryPrompt(issues, metrics);
    expect(prompt).toContain('14 columns');
  });
});

// ── Source-script in table cells ──────────────────────────────────────────────

describe('Source-script in table cells', () => {
  // A table cell that contains a long Thai fragment (≥20 chars) outside parentheses
  const TRANSLATION_THAI_IN_CELL = `# Лабораторный отчёт

## Данные пациента

| Параметр | Значение |
|---|---|
| Имя | Mr. Test Patient |
| HN | 6905154803 |
| Больница | ในกรณีที่ต้องการค่าความไม่แน่นอนขยาย |

## Результаты

| Исследование | Результат |
|---|---|
| ЭКГ | Норма |
`;

  it('detects LONG_SOURCE_SCRIPT_FRAGMENT_IN_TABLE', () => {
    const result = runTranslationQualityGate({
      sourceMarkdown: SOURCE_MARKDOWN,
      translatedMarkdown: TRANSLATION_THAI_IN_CELL,
      sourceLang: 'th',
      targetLang: 'ru',
    });
    const issue = result.issues.find(i => i.code === 'LONG_SOURCE_SCRIPT_FRAGMENT_IN_TABLE');
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('retry_required');
  });

  it('does NOT flag short Thai in parentheses (official original spelling)', () => {
    // "เมืองวอยเล็บ" (11 chars) in parens is acceptable
    const result = runTranslationQualityGate({
      sourceMarkdown: SOURCE_MARKDOWN,
      translatedMarkdown: GOOD_TRANSLATION,
      sourceLang: 'th',
      targetLang: 'ru',
    });
    const issue = result.issues.find(i => i.code === 'LONG_SOURCE_SCRIPT_FRAGMENT_IN_TABLE');
    expect(issue).toBeUndefined();
  });

  it('retry prompt mentions table cells', () => {
    const { issues, metrics } = runTranslationQualityGate({
      sourceMarkdown: SOURCE_MARKDOWN,
      translatedMarkdown: TRANSLATION_THAI_IN_CELL,
      sourceLang: 'th',
      targetLang: 'ru',
    });
    const prompt = buildQualityRetryPrompt(issues, metrics);
    expect(prompt).toContain('table cell');
  });
});

// ── Certification identifier evidence check ───────────────────────────────────

describe('Certification identifier evidence check', () => {
  const BAD_TRANSLATION_WRONG_CERT = `# Лабораторный отчёт

## Результаты

Тест по ISO 13485.
Также используется ISO 15189.

| Test | Value |
|---|---|
| Result | Normal |
`;

  it('detects UNSUPPORTED_CERTIFICATION_IDENTIFIER when translation adds ISO 13485 (not in source)', () => {
    const result = runTranslationQualityGate({
      sourceMarkdown: SOURCE_MARKDOWN,
      translatedMarkdown: BAD_TRANSLATION_WRONG_CERT,
      sourceLang: 'th',
      targetLang: 'ru',
    });
    const issue = result.issues.find(i => i.code === 'UNSUPPORTED_CERTIFICATION_IDENTIFIER');
    expect(issue).toBeDefined();
    expect(issue!.details).toContain('ISO13485');
  });

  it('does NOT flag ISO 15189 which is present in source', () => {
    const result = runTranslationQualityGate({
      sourceMarkdown: SOURCE_MARKDOWN,
      translatedMarkdown: BAD_TRANSLATION_WRONG_CERT,
      sourceLang: 'th',
      targetLang: 'ru',
    });
    const certIssues = result.issues.filter(i => i.code === 'UNSUPPORTED_CERTIFICATION_IDENTIFIER');
    const iso15189Issue = certIssues.find(i => i.details.includes('15189'));
    expect(iso15189Issue).toBeUndefined();
  });

  it('GOOD_TRANSLATION fixture contains ISO 15189', () => {
    expect(GOOD_TRANSLATION).toContain('ISO 15189');
  });

  it('GOOD_TRANSLATION fixture does not contain ISO 13485', () => {
    expect(GOOD_TRANSLATION).not.toContain('ISO 13485');
  });

  it('GOOD_TRANSLATION passes certification identifier check', () => {
    const result = runTranslationQualityGate({
      sourceMarkdown: SOURCE_MARKDOWN,
      translatedMarkdown: GOOD_TRANSLATION,
      sourceLang: 'th',
      targetLang: 'ru',
    });
    const certIssues = result.issues.filter(i => i.code === 'UNSUPPORTED_CERTIFICATION_IDENTIFIER');
    expect(certIssues).toHaveLength(0);
  });

  it('extractCertificationIdentifiers correctly normalizes ISO identifiers', () => {
    const ids = extractCertificationIdentifiers('# ISO 15189 and IEC 62133:2012 and ILAC-MRA');
    expect(ids.has('ISO15189')).toBe(true);
    expect(ids.has('IEC6213320120')).toBe(false); // colon/year stripped differently
    expect(ids.has('ILACMRA')).toBe(true);
  });
});

describe('Script validator — Thai detection in Cyrillic target', () => {
  // Indirect: verify that the bad translation contains Thai fragments
  // that the script validator would flag (tested via validateTranslationScript)
  it('source script detection counts Thai chars in bad translation', () => {
    const result = runTranslationQualityGate({
      sourceMarkdown: SOURCE_MARKDOWN,
      translatedMarkdown: BAD_TRANSLATION,
      sourceLang: 'th',
      targetLang: 'ru',
    });
    // The bad translation has a full Thai paragraph
    expect(result.metrics.remainingSourceScriptCharacterCount).toBeGreaterThan(30);
  });

  it('source script detection finds zero or minimal Thai in good translation', () => {
    const result = runTranslationQualityGate({
      sourceMarkdown: SOURCE_MARKDOWN,
      translatedMarkdown: GOOD_TRANSLATION,
      sourceLang: 'th',
      targetLang: 'ru',
    });
    // Only "เมืองวอยเล็บ" in parentheses (original spelling) is allowed
    expect(result.metrics.remainingSourceScriptRatio).toBeLessThan(0.02);
  });
});
