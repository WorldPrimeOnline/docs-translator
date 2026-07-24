/**
 * 2026-07-25 dashboard progress-UI fix: pure helpers behind useStatusLabel().
 */
import { isPipelineCustomerStatus, formatStatusLabelWithProgress } from '../status-label';

describe('isPipelineCustomerStatus', () => {
  it('is true for the worker pipeline statuses that used to show separate technical labels', () => {
    expect(isPipelineCustomerStatus('queued')).toBe(true);
    expect(isPipelineCustomerStatus('ocr_in_progress')).toBe(true);
    expect(isPipelineCustomerStatus('translation_in_progress')).toBe(true);
    expect(isPipelineCustomerStatus('pdf_rendering')).toBe(true);
  });

  it('is false for every other status', () => {
    for (const s of ['payment_pending', 'awaiting_translator_review', 'translator_review_in_progress', 'notarized', 'delivered', 'completed', 'failed', null]) {
      expect(isPipelineCustomerStatus(s)).toBe(false);
    }
  });
});

describe('formatStatusLabelWithProgress', () => {
  it('appends "(N%)" for a non-terminal order', () => {
    expect(formatStatusLabelWithProgress('Подготовка документа к обработке', false, 42)).toBe('Подготовка документа к обработке (42%)');
  });

  it('never appends a percent suffix for a terminal order, even though the underlying value is 100', () => {
    expect(formatStatusLabelWithProgress('Доставлено', true, 100)).toBe('Доставлено');
  });

  it('shows the percent for every non-terminal status, not just the old ocr/translating/rendering ones — the "percent disappears" bug this closes', () => {
    expect(formatStatusLabelWithProgress('Ожидает оплаты', false, 25)).toContain('25%');
    expect(formatStatusLabelWithProgress('Переводчик проверяет перевод', false, 50)).toContain('50%');
    expect(formatStatusLabelWithProgress('В работе у нотариуса', false, 80)).toContain('80%');
  });
});
