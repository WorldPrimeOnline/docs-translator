import {
  classifyBracketMarker,
  deduplicateVisualElements,
} from '@/lib/translation-ast/visual-classifier';
import type { DetectedVisualElement } from '@/lib/translation-ast/visual-classifier';

describe('classifyBracketMarker', () => {
  it('[QR] → qr', () => {
    expect(classifyBracketMarker('[QR]')).toBe('qr');
  });
  it('[qr code] → qr', () => {
    expect(classifyBracketMarker('[qr code]')).toBe('qr');
  });
  it('[QR-code] → qr', () => {
    expect(classifyBracketMarker('[QR-code]')).toBe('qr');
  });
  it('[barcode] → barcode (ASCII universal term)', () => {
    expect(classifyBracketMarker('[barcode]')).toBe('barcode');
  });
  it('[1234567890] → barcode (dense digits)', () => {
    expect(classifyBracketMarker('[1234567890]')).toBe('barcode');
  });
  it('[A1B2C3D4E5<<<<<<<<<<<<<] → mrz (structural MRZ pattern)', () => {
    expect(classifyBracketMarker('[A1B2C3D4E5<<<<<<<<<<<<<]')).toBe('mrz');
  });
  it('[ABCDEFGHIJ<<<<<<<<] → mrz', () => {
    expect(classifyBracketMarker('[ABCDEFGHIJ<<<<<<<<]')).toBe('mrz');
  });
  it('[xyz] → unknown_image', () => {
    expect(classifyBracketMarker('[xyz]')).toBe('unknown_image');
  });
  it('[some text] → unknown_image', () => {
    expect(classifyBracketMarker('[some text]')).toBe('unknown_image');
  });
  it('input without brackets (just content) → still works', () => {
    expect(classifyBracketMarker('QR')).toBe('qr');
  });
});

describe('deduplicateVisualElements', () => {
  function el(
    kind: DetectedVisualElement['kind'],
    page: number,
    position: DetectedVisualElement['position'],
    confidence = 0.9,
    idx = 0,
  ): DetectedVisualElement {
    return { kind, page, position, confidence, occurrenceIndex: idx };
  }

  it('returns empty array for empty input', () => {
    expect(deduplicateVisualElements([])).toEqual([]);
  });

  it('3 elements with same page/kind/position → 1 result (highest confidence)', () => {
    const input: DetectedVisualElement[] = [
      el('stamp', 1, 'bottom_right', 0.7),
      el('stamp', 1, 'bottom_right', 0.95),
      el('stamp', 1, 'bottom_right', 0.5),
    ];
    const result = deduplicateVisualElements(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBe(0.95);
  });

  it('different positions → all kept', () => {
    const input: DetectedVisualElement[] = [
      el('stamp', 1, 'top_left', 0.9),
      el('stamp', 1, 'bottom_right', 0.8),
      el('stamp', 1, 'center', 0.7),
    ];
    const result = deduplicateVisualElements(input);
    expect(result).toHaveLength(3);
  });

  it('different pages → all kept', () => {
    const input: DetectedVisualElement[] = [
      el('stamp', 1, 'bottom_right', 0.9),
      el('stamp', 2, 'bottom_right', 0.9),
      el('stamp', 3, 'bottom_right', 0.9),
    ];
    const result = deduplicateVisualElements(input);
    expect(result).toHaveLength(3);
  });

  it('different kinds on same page → all kept', () => {
    const input: DetectedVisualElement[] = [
      el('stamp', 1, 'bottom_right', 0.9),
      el('signature', 1, 'bottom_right', 0.8),
      el('qr', 1, 'top_right', 0.7),
    ];
    const result = deduplicateVisualElements(input);
    expect(result).toHaveLength(3);
  });

  it('occurrenceIndex assigned correctly per (page, kind)', () => {
    const input: DetectedVisualElement[] = [
      el('stamp', 1, 'top_left', 0.9),
      el('stamp', 1, 'bottom_right', 0.8),
      el('stamp', 2, 'top_left', 0.7),
      el('signature', 1, 'bottom_left', 0.9),
    ];
    const result = deduplicateVisualElements(input);
    // All 4 should be kept (different page or position)
    expect(result).toHaveLength(4);
    // Stamps on page 1: indices 0, 1
    const stampsP1 = result.filter((e) => e.kind === 'stamp' && e.page === 1);
    expect(stampsP1).toHaveLength(2);
    const indices = stampsP1.map((e) => e.occurrenceIndex).sort();
    expect(indices).toEqual([0, 1]);
    // Stamp on page 2: index 0
    const stampP2 = result.find((e) => e.kind === 'stamp' && e.page === 2);
    expect(stampP2?.occurrenceIndex).toBe(0);
    // Signature on page 1: index 0
    const sig = result.find((e) => e.kind === 'signature');
    expect(sig?.occurrenceIndex).toBe(0);
  });

  it('IoU > 0.5 bboxes merged into single element', () => {
    const input: DetectedVisualElement[] = [
      {
        kind: 'stamp', page: 1, position: 'bottom_right', confidence: 0.7, occurrenceIndex: 0,
        bbox: { x: 0.6, y: 0.7, width: 0.2, height: 0.2 },
      },
      {
        kind: 'stamp', page: 1, position: 'bottom_right', confidence: 0.9, occurrenceIndex: 0,
        bbox: { x: 0.62, y: 0.72, width: 0.2, height: 0.2 },
      },
    ];
    const result = deduplicateVisualElements(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.confidence).toBe(0.9);
  });

  it('non-overlapping bboxes (IoU < 0.5) kept separately', () => {
    const input: DetectedVisualElement[] = [
      {
        kind: 'stamp', page: 1, position: 'bottom_right', confidence: 0.9, occurrenceIndex: 0,
        bbox: { x: 0.0, y: 0.0, width: 0.3, height: 0.3 },
      },
      {
        kind: 'stamp', page: 1, position: 'bottom_right', confidence: 0.8, occurrenceIndex: 0,
        bbox: { x: 0.7, y: 0.7, width: 0.3, height: 0.3 },
      },
    ];
    const result = deduplicateVisualElements(input);
    expect(result).toHaveLength(2);
  });
});
