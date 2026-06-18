import {
  classifyUrl,
  convertOcrElementsToDetected,
  mergeDetectedElements,
  type DetectedVisualElement,
} from '../detected-visual-element';
import type { VisualElement } from '../visual-elements';

describe('classifyUrl', () => {
  test('www.sml.kz → contact_url', () => {
    expect(classifyUrl('www.sml.kz')).toBe('contact_url');
  });

  test('https://www.ministry.kz → contact_url', () => {
    expect(classifyUrl('https://www.ministry.kz')).toBe('contact_url');
  });

  test('https://verify.gov.kz/check/doc=123 → verification_url', () => {
    expect(classifyUrl('https://verify.gov.kz/check/doc=123')).toBe('verification_url');
  });

  test('https://e-gov.kz/validate/cert → verification_url', () => {
    expect(classifyUrl('https://e-gov.kz/validate/cert')).toBe('verification_url');
  });

  test('url with ?code= param → verification_url', () => {
    expect(classifyUrl('https://docs.kz/api?code=ABC123')).toBe('verification_url');
  });

  test('url with ?id= param → verification_url', () => {
    expect(classifyUrl('https://docs.kz/api?id=123')).toBe('verification_url');
  });
});

describe('convertOcrElementsToDetected', () => {
  const OCR_ELEMENTS: VisualElement[] = [
    { kind: 'signature', page: 1, text: '[director signature]', source: 'markdown_marker' },
    { kind: 'signature', page: 1, text: '[accountant signature]', source: 'markdown_marker' },
    { kind: 'stamp', page: 1, text: '[round stamp]', source: 'markdown_marker' },
    { kind: 'qr', page: 1, text: '[QR code present]', source: 'markdown_marker' },
    { kind: 'verification_string', page: 1, text: 'https://verify.kz', source: 'regex' },
    { kind: 'mrz', page: 1, text: 'P<KAZYUDENOV<<GLEB', source: 'regex' },
  ];

  test('filters out verification_string and mrz (only VisualElementKindExtended kinds survive)', () => {
    const detected = convertOcrElementsToDetected(OCR_ELEMENTS);
    // signature×2 + stamp + qr = 4  (verification_string and mrz are filtered out)
    expect(detected).toHaveLength(4);
  });

  test('two signatures convert to two elements', () => {
    const detected = convertOcrElementsToDetected(OCR_ELEMENTS);
    const sigs = detected.filter(e => e.kind === 'signature');
    expect(sigs).toHaveLength(2);
  });

  test('occurrenceIndex is incremented per (page, kind)', () => {
    const detected = convertOcrElementsToDetected(OCR_ELEMENTS);
    const sigs = detected.filter(e => e.kind === 'signature');
    expect(sigs[0]?.occurrenceIndex).toBe(0);
    expect(sigs[1]?.occurrenceIndex).toBe(1);
  });

  test('assigns unique IDs', () => {
    const detected = convertOcrElementsToDetected(OCR_ELEMENTS);
    const ids = detected.map(e => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('mergeDetectedElements', () => {
  const makeVisionEl = (
    page: number,
    kind: DetectedVisualElement['kind'],
    position: DetectedVisualElement['position'],
  ): DetectedVisualElement => ({
    id: `v_${page}_${kind}`,
    page,
    kind,
    occurrenceIndex: 0,
    position,
    confidence: 0.9,
    source: 'page_vision',
  });

  test('two signatures from vision → two elements in merged', () => {
    const ocr: DetectedVisualElement[] = [];
    const vision: DetectedVisualElement[] = [
      makeVisionEl(1, 'signature', 'lower_left'),
      makeVisionEl(1, 'signature', 'lower_right'),
    ];
    const merged = mergeDetectedElements(ocr, vision);
    expect(merged.filter(e => e.kind === 'signature')).toHaveLength(2);
  });

  test('OCR qr not in vision → added to merged', () => {
    const ocrEl: DetectedVisualElement = {
      id: 'ocr_1', page: 1, kind: 'qr', occurrenceIndex: 0, position: 'lower_right',
      confidence: 0.7, source: 'markdown_marker',
    };
    const vision = [makeVisionEl(1, 'signature', 'lower_left')];
    const merged = mergeDetectedElements([ocrEl], vision);
    expect(merged.find(e => e.kind === 'qr')).toBeTruthy();
    expect(merged.find(e => e.kind === 'signature')).toBeTruthy();
  });

  test('vision stamp coverage suppresses OCR stamp on same page', () => {
    const ocrEl: DetectedVisualElement = {
      id: 'ocr_1', page: 1, kind: 'stamp', occurrenceIndex: 0, position: 'unknown',
      confidence: 0.7, source: 'markdown_marker', visibleText: '[round stamp]',
    };
    const vision = [makeVisionEl(1, 'stamp', 'lower_right')];
    const merged = mergeDetectedElements([ocrEl], vision);
    // Vision found stamp → OCR stamp suppressed; only 1 stamp
    expect(merged.filter(e => e.kind === 'stamp')).toHaveLength(1);
    // Vision element is authoritative
    expect(merged.filter(e => e.kind === 'stamp')[0]?.source).toBe('page_vision');
  });

  test('OCR visible text enriches vision element with no visibleText', () => {
    const ocrEl: DetectedVisualElement = {
      id: 'ocr_1', page: 1, kind: 'stamp', occurrenceIndex: 0, position: 'unknown',
      confidence: 0.7, source: 'markdown_marker', visibleText: 'SML GROUP LLP',
    };
    const visionEl: DetectedVisualElement = {
      ...makeVisionEl(1, 'stamp', 'lower_right'),
    };
    const merged = mergeDetectedElements([ocrEl], [visionEl]);
    const stamp = merged.find(e => e.kind === 'stamp');
    expect(stamp?.visibleText).toBe('SML GROUP LLP');
  });

  test('merged result has re-assigned IDs', () => {
    const ocr: DetectedVisualElement[] = [];
    const vision = [makeVisionEl(1, 'logo', 'header'), makeVisionEl(1, 'signature', 'lower_left')];
    const merged = mergeDetectedElements(ocr, vision);
    expect(merged[0]?.id).toBe('det_1');
    expect(merged[1]?.id).toBe('det_2');
  });
});
