'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CalculateFormState } from './types';

interface AnalyzeFileResponse {
  fileKey: string;
  filename: string;
  method: string;
  rawCharacterCount: number;
  characterCount: number;
  normalizedTextPreview: string;
  physicalPageCount: number;
  qualitySignals: {
    method: string;
    rawCharacterCount: number;
    emptyOrNearEmpty: boolean;
    charsPerPhysicalPage: number;
    possiblyHandwrittenOrIllegible: boolean;
    ocrPageCount?: number;
  };
  requiresOperatorReview: boolean;
  reviewReasons: string[];
}

const METHOD_LABELS: Record<string, string> = {
  docx_text: 'DOCX (текст извлечён напрямую)',
  pdf_text_layer: 'PDF (текстовый слой)',
  ocr: 'OCR (Mistral, сканированный документ/изображение)',
  manual: 'Ручной ввод',
};

export function PricingLabFileMode({
  onApply,
}: {
  onApply: (patch: Partial<CalculateFormState>) => void;
}) {
  const [analysis, setAnalysis] = useState<AnalyzeFileResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideCharCount, setOverrideCharCount] = useState<number | null>(null);
  const [overridePages, setOverridePages] = useState<number | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [showText, setShowText] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setAnalysis(null);
    setOverrideCharCount(null);
    setOverridePages(null);
    setOverrideReason('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/internal/pricing-lab/analyze-file', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Ошибка анализа файла');
        return;
      }
      setAnalysis(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  }

  async function handleDelete() {
    if (!analysis) return;
    await fetch(`/api/internal/pricing-lab/analyze-file?fileKey=${encodeURIComponent(analysis.fileKey)}`, { method: 'DELETE' });
    setAnalysis(null);
  }

  function applyToCalculator() {
    if (!analysis) return;
    const characterCount = overrideCharCount ?? analysis.characterCount;
    const physicalPageCount = overridePages ?? analysis.physicalPageCount;
    onApply({ sourceCharacterCountWithSpaces: characterCount, physicalPageCount });
  }

  const hasOverride = overrideCharCount !== null || overridePages !== null;

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader><CardTitle>Загрузка документа</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <input
            type="file"
            accept=".docx,.pdf,.jpg,.jpeg,.png"
            onChange={handleUpload}
            disabled={uploading}
            className="text-sm"
          />
          {uploading && <p className="mt-2 text-sm text-muted-foreground">Анализирую документ…</p>}
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive bg-destructive/10"><CardContent className="pt-4 text-sm text-destructive">{error}</CardContent></Card>
      )}

      {analysis && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Результат анализа</CardTitle>
            <Button variant="ghost" size="sm" onClick={handleDelete}>Удалить файл сейчас</Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0 text-sm">
            <div>Метод: <strong>{METHOD_LABELS[analysis.method] ?? analysis.method}</strong></div>
            <div>Символов (сырые): {analysis.rawCharacterCount}</div>
            <div>Символов (после нормализации): {analysis.characterCount}</div>
            <div>Расчётные страницы: {Math.max(1, analysis.characterCount / 1800).toFixed(2)}</div>
            <div>Физических страниц: {analysis.physicalPageCount}</div>
            <div className="text-xs text-muted-foreground">
              Символов/физ.страницу: {analysis.qualitySignals.charsPerPhysicalPage.toFixed(1)}
              {analysis.qualitySignals.possiblyHandwrittenOrIllegible && ' — возможно рукописный/нечитаемый документ'}
              {analysis.method === 'ocr' && analysis.qualitySignals.ocrPageCount != null && ` · OCR-страниц: ${analysis.qualitySignals.ocrPageCount}`}
            </div>

            {analysis.requiresOperatorReview && (
              <div className="rounded border border-amber-500 bg-amber-500/10 p-2">
                <p className="font-medium text-amber-700">Требуется проверка оператора:</p>
                <ul className="list-disc pl-5">
                  {analysis.reviewReasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            )}

            <button type="button" className="w-fit text-xs text-muted-foreground underline" onClick={() => setShowText((s) => !s)}>
              {showText ? 'Скрыть текст после нормализации' : 'Показать текст после нормализации'}
            </button>
            {showText && (
              <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{analysis.normalizedTextPreview}</pre>
            )}

            <div className="mt-2 grid grid-cols-2 gap-2 border-t pt-2">
              <div>
                <Label className="text-xs">Ручная корректировка: символов</Label>
                <Input type="number" placeholder={String(analysis.characterCount)}
                  value={overrideCharCount ?? ''} onChange={(e) => setOverrideCharCount(e.target.value === '' ? null : Number(e.target.value))} />
              </div>
              <div>
                <Label className="text-xs">Ручная корректировка: физ. страниц</Label>
                <Input type="number" placeholder={String(analysis.physicalPageCount)}
                  value={overridePages ?? ''} onChange={(e) => setOverridePages(e.target.value === '' ? null : Number(e.target.value))} />
              </div>
              {hasOverride && (
                <div className="col-span-2">
                  <Label className="text-xs">Причина корректировки (метод: manual)</Label>
                  <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="Обязательна для ручного override" />
                </div>
              )}
            </div>

            <Button className="mt-2 w-fit" onClick={applyToCalculator} disabled={hasOverride && !overrideReason.trim()}>
              Использовать в расчёте цены
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
