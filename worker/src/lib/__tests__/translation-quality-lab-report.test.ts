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
