'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PricingLabResult } from './PricingLabResult';
import { PricingLabFileMode } from './PricingLabFileMode';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  DEFAULT_FORM_STATE, PRICING_LAB_PRESETS, VERSION_OVERRIDE_KEYS, VERSION_OVERRIDE_LABELS,
  type CalculateFormState, type VersionOverrides,
} from './types';

interface PricingVersionSummary { id: string; code: string; status: string; createdAt: string; formulaVersion: string }
interface PartnerSummary { id: string; name: string; commissionRate: number; partnerType: string }
type LanguageRatePreview = { rateKztPerTranslationPage: number; active: boolean; requiresOperatorReview: boolean; id: string } | null;

interface SavedScenario {
  id: string;
  label: string;
  form: CalculateFormState;
  result: unknown;
  savedAt: string;
}

const HISTORY_KEY = 'wpo-pricing-lab-scenarios-v1';

function loadScenarios(): SavedScenario[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
function persistScenarios(scenarios: SavedScenario[]) {
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(scenarios));
}

export function PricingLabClient() {
  const [form, setForm] = useState<CalculateFormState>(DEFAULT_FORM_STATE);
  const [versions, setVersions] = useState<PricingVersionSummary[]>([]);
  const [partners, setPartners] = useState<PartnerSummary[]>([]);
  const [languageRatePreview, setLanguageRatePreview] = useState<{ rate: LanguageRatePreview; message?: string } | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showOverrides, setShowOverrides] = useState(false);
  const [activeTab, setActiveTab] = useState<'manual' | 'file'>('manual');
  const [scenarios, setScenarios] = useState<SavedScenario[]>([]);
  const [compareIds, setCompareIds] = useState<string[]>([]);

  useEffect(() => {
    setScenarios(loadScenarios());
    fetch('/api/internal/pricing-lab/pricing-versions').then((r) => r.json()).then((d) => setVersions(d.versions ?? []));
    fetch('/api/internal/pricing-lab/partners').then((r) => r.json()).then((d) => setPartners(d.partners ?? []));
  }, []);

  const currentVersion = versions.find((v) => v.code === form.pricingVersionCode);

  useEffect(() => {
    if (!currentVersion) return;
    const params = new URLSearchParams({ versionId: currentVersion.id, source: form.sourceLanguage, target: form.targetLanguage });
    fetch(`/api/internal/pricing-lab/language-rate?${params}`).then((r) => r.json()).then(setLanguageRatePreview);
  }, [currentVersion, form.sourceLanguage, form.targetLanguage]);

  const isNotary = form.serviceLevel === 'notarization_through_partners';

  const calculate = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body = {
        pricingVersionCode: form.pricingVersionCode,
        serviceLevel: form.serviceLevel,
        sourceLanguage: form.sourceLanguage,
        targetLanguage: form.targetLanguage,
        sourceCharacterCountWithSpaces: form.sourceCharacterCountWithSpaces,
        physicalPageCount: form.physicalPageCount,
        ...(isNotary ? {
          applicantType: form.applicantType,
          fulfillmentMethod: form.fulfillmentMethod,
          deliveryRequired: form.deliveryRequired,
          notaryUrgencyLevel: form.notaryUrgencyLevel,
          notaryUrgencyWindowOverride: form.notaryUrgencyWindowOverride,
          extraPaperCopies: form.extraPaperCopies,
        } : {}),
        salesChannel: form.salesChannel,
        ...(form.salesChannel === 'referral' ? {
          partnerId: form.partnerId,
          partnerCommissionRateOverride: form.partnerId ? undefined : form.partnerCommissionRateOverride,
        } : {}),
        manualAdjustmentKzt: form.manualAdjustmentKzt || undefined,
        manualAdjustmentReason: form.manualAdjustmentReason || undefined,
        languageRateOverrideKzt: form.languageRateOverrideKzt,
        versionOverrides: form.versionOverrides,
      };
      const res = await fetch('/api/internal/pricing-lab/calculate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Ошибка расчёта');
        return;
      }
      setResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [form, isNotary]);

  function loadPreset(presetId: string) {
    const preset = PRICING_LAB_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setForm({ ...DEFAULT_FORM_STATE, ...preset.form, versionOverrides: {} });
    setResult(null);
    setError(null);
  }

  function setOverride(key: keyof VersionOverrides, value: number | undefined) {
    setForm((f) => ({ ...f, versionOverrides: { ...f.versionOverrides, [key]: value } }));
  }
  function resetOverrides() {
    setForm((f) => ({ ...f, versionOverrides: {} }));
  }

  function saveScenario() {
    if (!result) return;
    const label = window.prompt('Название сценария:', `${form.serviceLevel === 'notarization_through_partners' ? 'Notary' : 'Official'} ${form.sourceLanguage}→${form.targetLanguage}`);
    if (!label) return;
    const scenario: SavedScenario = { id: crypto.randomUUID(), label, form, result, savedAt: new Date().toISOString() };
    const next = [scenario, ...scenarios].slice(0, 50);
    setScenarios(next);
    persistScenarios(next);
  }
  function duplicateScenario(id: string) {
    const s = scenarios.find((sc) => sc.id === id);
    if (!s) return;
    setForm(s.form);
    setResult(s.result);
  }
  function clearScenarios() {
    if (!window.confirm('Удалить всю историю сценариев (localStorage)?')) return;
    setScenarios([]);
    persistScenarios([]);
  }
  function exportConfigJson() {
    const blob = new Blob([JSON.stringify(form, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'pricing-lab-config.json'; a.click();
    URL.revokeObjectURL(url);
  }
  function importConfigJson(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setError('Некорректный JSON');
        return;
      }
      const allowedKeys = new Set(Object.keys(DEFAULT_FORM_STATE));
      if (typeof parsed !== 'object' || parsed === null) {
        setError('JSON должен быть объектом');
        return;
      }
      const unknownKeys = Object.keys(parsed).filter((k) => !allowedKeys.has(k));
      if (unknownKeys.length > 0) {
        setError(`Неизвестные поля в JSON: ${unknownKeys.join(', ')}`);
        return;
      }
      setForm({ ...DEFAULT_FORM_STATE, ...(parsed as Partial<CalculateFormState>) });
      setError(null);
    });
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
      <div className="sticky top-0 z-10 rounded-md border-2 border-amber-500 bg-amber-500/20 px-4 py-2 text-center text-sm font-bold uppercase tracking-wide text-amber-900 dark:text-amber-200">
        STAGING · ТЕСТОВЫЙ КАЛЬКУЛЯТОР · реальные заказы и платежи не создаются
      </div>
      <h1 className="text-xl font-semibold">WPO Pricing Lab</h1>
      <p className="text-sm text-muted-foreground">
        Внутренний инструмент проверки экономики заказов. Использует реальный calculatePrice() — никаких заказов, оплат, Jira issue или Drive folder не создаётся.
      </p>

      <Card>
        <CardHeader><CardTitle>Presets</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2 pt-0">
          {PRICING_LAB_PRESETS.map((p) => (
            <Button key={p.id} variant="outline" size="sm" onClick={() => loadPreset(p.id)} title={p.description}>
              {p.label}
            </Button>
          ))}
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'manual' | 'file')}>
        <TabsList>
          <TabsTrigger value="manual">Ручной расчёт</TabsTrigger>
          <TabsTrigger value="file">Рассчитать по документу</TabsTrigger>
        </TabsList>

        <TabsContent value="file">
          <PricingLabFileMode
            onApply={(patch) => {
              setForm((f) => ({ ...f, ...patch }));
              setActiveTab('manual');
            }}
          />
        </TabsContent>

        <TabsContent value="manual">
      <Card>
        <CardHeader><CardTitle>A. Входные данные</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 pt-0 md:grid-cols-3">
          <div>
            <Label>Версия цен</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={form.pricingVersionCode}
              onChange={(e) => setForm({ ...form, pricingVersionCode: e.target.value })}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.code}>{v.code} ({v.status})</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Услуга</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={form.serviceLevel}
              onChange={(e) => setForm({ ...form, serviceLevel: e.target.value as CalculateFormState['serviceLevel'] })}
            >
              <option value="official_with_translator_signature_and_provider_stamp">Official (с печатью)</option>
              <option value="notarization_through_partners">Notary (нотариальное)</option>
            </select>
          </div>
          <div>
            <Label>Канал</Label>
            <select
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              value={form.salesChannel}
              onChange={(e) => setForm({ ...form, salesChannel: e.target.value as CalculateFormState['salesChannel'] })}
            >
              <option value="direct">Direct</option>
              <option value="referral">Referral</option>
            </select>
          </div>

          <div>
            <Label>Исходный язык</Label>
            <Input value={form.sourceLanguage} onChange={(e) => setForm({ ...form, sourceLanguage: e.target.value })} />
          </div>
          <div>
            <Label>Целевой язык</Label>
            <Input value={form.targetLanguage} onChange={(e) => setForm({ ...form, targetLanguage: e.target.value })} />
          </div>
          <div className="flex flex-col justify-end text-xs text-muted-foreground">
            {languageRatePreview?.rate ? (
              <>
                <span>Ставка: {languageRatePreview.rate.rateKztPerTranslationPage} ₸/стр. (ID: {languageRatePreview.rate.id})</span>
                <span>active={String(languageRatePreview.rate.active)}, review={String(languageRatePreview.rate.requiresOperatorReview)}</span>
              </>
            ) : (
              <span className="text-destructive">{languageRatePreview?.message ?? 'Ставка не найдена'}</span>
            )}
          </div>

          <div>
            <Label>Символов с пробелами</Label>
            <Input type="number" value={form.sourceCharacterCountWithSpaces}
              onChange={(e) => setForm({ ...form, sourceCharacterCountWithSpaces: Number(e.target.value) })} />
            <p className="mt-1 text-xs text-muted-foreground">
              Расчётные страницы: {Math.max(1, form.sourceCharacterCountWithSpaces / 1800).toFixed(2)} (симв. / 1800, мин. 1)
            </p>
          </div>
          <div>
            <Label>Физических страниц</Label>
            <Input type="number" value={form.physicalPageCount}
              onChange={(e) => setForm({ ...form, physicalPageCount: Number(e.target.value) })} />
          </div>

          {isNotary && (
            <>
              <div>
                <Label>Заявитель</Label>
                <select className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={form.applicantType} onChange={(e) => setForm({ ...form, applicantType: e.target.value as CalculateFormState['applicantType'] })}>
                  <option value="individual">Физлицо</option>
                  <option value="legal_entity">Юрлицо</option>
                </select>
              </div>
              <div>
                <Label>Доставка</Label>
                <select className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={form.deliveryRequired ? 'yes' : 'no'}
                  onChange={(e) => setForm({ ...form, deliveryRequired: e.target.value === 'yes', fulfillmentMethod: e.target.value === 'yes' ? 'delivery' : 'pickup' })}>
                  <option value="no">Нет</option>
                  <option value="yes">Да</option>
                </select>
              </div>
              <div>
                <Label>Нотариальная срочность</Label>
                <select className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={form.notaryUrgencyLevel === 'standard' ? 'standard' : (form.notaryUrgencyWindowOverride ?? 'before_noon')}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === 'standard') setForm({ ...form, notaryUrgencyLevel: 'standard', notaryUrgencyWindowOverride: undefined });
                    else setForm({ ...form, notaryUrgencyLevel: 'same_day', notaryUrgencyWindowOverride: v as 'before_noon' | 'after_noon' | 'after_18' });
                  }}>
                  <option value="standard">Standard ×1</option>
                  <option value="before_noon">Same-day до 12:00 ×1</option>
                  <option value="after_noon">Same-day 12:00–18:00 ×1.5</option>
                  <option value="after_18">Same-day после 18:00 ×2</option>
                </select>
              </div>
              <div>
                <Label>Доп. бумажные копии</Label>
                <Input type="number" value={form.extraPaperCopies}
                  onChange={(e) => setForm({ ...form, extraPaperCopies: Number(e.target.value) })} />
              </div>
            </>
          )}

          {form.salesChannel === 'referral' && (
            <>
              <div>
                <Label>Партнёр (staging)</Label>
                <select className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  value={form.partnerId ?? ''} onChange={(e) => setForm({ ...form, partnerId: e.target.value || undefined })}>
                  <option value="">— вручную —</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({(p.commissionRate * 100).toFixed(0)}%)</option>
                  ))}
                </select>
              </div>
              {!form.partnerId && (
                <div>
                  <Label>Комиссия партнёру (вручную)</Label>
                  <select className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    value={form.partnerCommissionRateOverride ?? 0.05}
                    onChange={(e) => setForm({ ...form, partnerCommissionRateOverride: Number(e.target.value) })}>
                    <option value={0.05}>5%</option>
                    <option value={0.10}>10%</option>
                  </select>
                </div>
              )}
            </>
          )}

          <div>
            <Label>Ручная корректировка (₸)</Label>
            <Input type="number" value={form.manualAdjustmentKzt}
              onChange={(e) => setForm({ ...form, manualAdjustmentKzt: Number(e.target.value) })} />
          </div>
          <div className="col-span-2">
            <Label>Причина корректировки</Label>
            <Input value={form.manualAdjustmentReason}
              onChange={(e) => setForm({ ...form, manualAdjustmentReason: e.target.value })}
              placeholder="Обязательна, если корректировка != 0 (тестовый actor: pricing-lab)" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Временные overrides конфигурации версии</CardTitle>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowOverrides((s) => !s)}>{showOverrides ? 'Скрыть' : 'Показать'}</Button>
            <Button variant="ghost" size="sm" onClick={resetOverrides}>Сбросить к конфигурации версии</Button>
          </div>
        </CardHeader>
        {showOverrides && (
          <CardContent className="grid grid-cols-2 gap-3 pt-0 md:grid-cols-3">
            {VERSION_OVERRIDE_KEYS.map((key) => (
              <div key={key}>
                <Label className="text-xs">{VERSION_OVERRIDE_LABELS[key]}</Label>
                <Input
                  type="number" step="any"
                  placeholder="из версии (не изменено)"
                  value={form.versionOverrides[key] ?? ''}
                  onChange={(e) => setOverride(key, e.target.value === '' ? undefined : Number(e.target.value))}
                />
              </div>
            ))}
          </CardContent>
        )}
        <CardContent className="pt-0 text-xs text-muted-foreground">
          Overrides применяются только к текущему расчёту в памяти сервера — pricing_versions в БД не изменяется, новая версия не активируется.
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button onClick={calculate} disabled={loading}>{loading ? 'Считаю…' : 'Рассчитать'}</Button>
        <Button variant="outline" onClick={saveScenario} disabled={!result}>Сохранить сценарий</Button>
        <Button variant="outline" onClick={exportConfigJson}>Экспорт JSON</Button>
        <label className="inline-flex cursor-pointer items-center rounded-md border border-input bg-background px-2.5 text-sm">
          Импорт JSON
          <input type="file" accept="application/json" className="hidden" onChange={importConfigJson} />
        </label>
      </div>

      {error && (
        <Card className="border-destructive bg-destructive/10"><CardContent className="pt-4 text-sm text-destructive">{error}</CardContent></Card>
      )}

      {!!result && <PricingLabResult result={result as Parameters<typeof PricingLabResult>[0]['result']} />}

      {scenarios.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Сравнение сценариев ({scenarios.length})</CardTitle>
            <div className="flex gap-2">
              {compareIds.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setCompareIds([])}>Показать все ({scenarios.length})</Button>
              )}
              <Button variant="ghost" size="sm" onClick={clearScenarios}>Очистить</Button>
            </div>
          </CardHeader>
          <CardContent className="overflow-x-auto pt-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="p-1">Сравнить</th><th className="p-1">Сценарий</th><th className="p-1">Retail</th><th className="p-1">Скидка</th>
                  <th className="p-1">Actual payment</th><th className="p-1">Переводчик</th><th className="p-1">Маржа WPO</th>
                  <th className="p-1">Резервы</th><th className="p-1">Партнёр</th><th className="p-1">Остаток канала</th><th className="p-1"></th>
                </tr>
              </thead>
              <tbody>
                {(compareIds.length > 0 ? scenarios.filter((s) => compareIds.includes(s.id)) : scenarios).map((s) => {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const nm = (s.result as any)?.newModel;
                  const checked = compareIds.includes(s.id);
                  return (
                    <tr key={s.id} className="border-b">
                      <td className="p-1">
                        <input
                          type="checkbox" checked={checked}
                          onChange={(e) => setCompareIds((ids) => e.target.checked ? [...ids, s.id] : ids.filter((id) => id !== s.id))}
                        />
                      </td>
                      <td className="p-1">{s.label}</td>
                      <td className="p-1">{nm ? Math.round(nm.retailPriceKzt) : '—'}</td>
                      <td className="p-1">{nm ? Math.round(nm.clientDiscountKzt) : '—'}</td>
                      <td className="p-1">{nm ? Math.round(nm.actualPaymentKzt) : '—'}</td>
                      <td className="p-1">{nm ? Math.round(nm.translatorPayoutKzt) : '—'}</td>
                      <td className="p-1">{nm ? Math.round(nm.netProfitWpoKzt) : '—'}</td>
                      <td className="p-1">{nm ? Math.round(nm.totalInternalReservesKzt) : '—'}</td>
                      <td className="p-1">{nm ? Math.round(nm.partnerCommissionKzt) : '—'}</td>
                      <td className="p-1">{nm ? Math.round(nm.unusedChannelReserveKzt) : '—'}</td>
                      <td className="p-1"><Button variant="ghost" size="xs" onClick={() => duplicateScenario(s.id)}>Дублировать</Button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
