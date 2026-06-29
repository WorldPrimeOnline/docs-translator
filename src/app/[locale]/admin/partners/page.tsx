'use client';

/**
 * Internal operator page — Partner application review and approval.
 * Access at: /{locale}/admin/partners
 *
 * Auth: CRON_SECRET bearer token entered in-browser; stored in sessionStorage for
 * the session duration. Never persisted to localStorage.
 *
 * Hardcoded RU/EN labels — this is an internal tool for operators only.
 */

import React, { useState, useCallback, useEffect } from 'react';

interface Application {
  id: string;
  partner_type: string;
  name: string;
  email: string;
  organization: string | null;
  phone: string | null;
  message: string | null;
  ref_code: string | null;
  status: string;
  jira_issue_key: string | null;
  jira_issue_url: string | null;
  approved_partner_id: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
}

interface ApproveForm {
  referralCode: string;
  commissionRate: string;
  clientDiscountEnabled: boolean;
  clientDiscountType: 'percent' | 'fixed' | '';
  clientDiscountValue: string;
  clientDiscountMinOrder: string;
  clientDiscountMax: string;
  notes: string;
  approvedBy: string;
}

function defaultForm(app: Application): ApproveForm {
  const base = (app.organization ?? app.name)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 10);
  return {
    referralCode: base,
    commissionRate: '5',
    clientDiscountEnabled: false,
    clientDiscountType: '',
    clientDiscountValue: '',
    clientDiscountMinOrder: '',
    clientDiscountMax: '',
    notes: '',
    approvedBy: '',
  } as ApproveForm;
}

export default function AdminPartnersPage() {
  const [key, setKey] = useState('');
  const [authed, setAuthed] = useState(false);
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, ApproveForm>>({});
  const [results, setResults] = useState<Record<string, string>>({});

  const storedKey = typeof window !== 'undefined' ? sessionStorage.getItem('wpo_op_key') : null;

  useEffect(() => {
    if (storedKey) {
      setKey(storedKey);
      setAuthed(true);
    }
  }, [storedKey]);

  const loadApplications = useCallback(async (authKey: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/partners/applications', {
        headers: { Authorization: `Bearer ${authKey}` },
      });
      if (res.status === 401) {
        setError('Неверный ключ доступа.');
        setAuthed(false);
        sessionStorage.removeItem('wpo_op_key');
        return;
      }
      const data = await res.json() as { applications: Application[]; error?: string };
      if (!res.ok) { setError(data.error ?? 'Ошибка загрузки'); return; }
      setApplications(data.applications);
      const initForms: Record<string, ApproveForm> = {};
      for (const app of data.applications) {
        initForms[app.id] = defaultForm(app);
      }
      setForms(initForms);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    sessionStorage.setItem('wpo_op_key', key.trim());
    setAuthed(true);
    await loadApplications(key.trim());
  };

  useEffect(() => {
    if (authed && key) void loadApplications(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  const updateForm = (id: string, patch: Partial<ApproveForm>) => {
    setForms((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
  };

  const handleApprove = async (app: Application) => {
    const form = forms[app.id] ?? defaultForm(app);
    if (!form.approvedBy.trim()) {
      setResults((r) => ({ ...r, [app.id]: 'Укажите "Кто одобряет" (ваш email).' }));
      return;
    }
    setResults((r) => ({ ...r, [app.id]: '...' }));

    const body = {
      applicationId: app.id,
      referralCode: form.referralCode.trim() || undefined,
      commissionRate: Number(form.commissionRate) / 100,
      clientDiscountEnabled: form.clientDiscountEnabled,
      clientDiscountType: form.clientDiscountEnabled && form.clientDiscountType ? form.clientDiscountType : null,
      clientDiscountValue: form.clientDiscountEnabled && form.clientDiscountValue ? Number(form.clientDiscountValue) : null,
      clientDiscountMinOrderAmount: form.clientDiscountEnabled && form.clientDiscountMinOrder ? Number(form.clientDiscountMinOrder) : null,
      clientDiscountMaxAmount: form.clientDiscountEnabled && form.clientDiscountMax ? Number(form.clientDiscountMax) : null,
      notes: form.notes.trim() || null,
      approvedBy: form.approvedBy.trim(),
    };

    try {
      const res = await fetch('/api/admin/partners/approve-application', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { referralCode?: string; referralLink?: string; partnerId?: string; error?: string };
      if (!res.ok) {
        setResults((r) => ({ ...r, [app.id]: `Ошибка: ${data.error}` }));
        return;
      }
      setResults((r) => ({
        ...r,
        [app.id]: `Одобрено! Код: ${data.referralCode} | Ссылка: ${typeof window !== 'undefined' ? window.location.origin : ''}${data.referralLink}`,
      }));
      setApplications((prev) => prev.filter((a) => a.id !== app.id));
    } catch (e) {
      setResults((r) => ({ ...r, [app.id]: `Ошибка запроса: ${String(e)}` }));
    }
  };

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-8">
        <form onSubmit={handleKeySubmit} className="flex flex-col gap-4 w-full max-w-sm">
          <h1 className="text-xl font-semibold text-foreground">Оператор — партнёры</h1>
          <p className="text-sm text-muted-foreground">Введите ключ доступа (CRON_SECRET):</p>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-foreground text-sm outline-none focus:border-primary"
            placeholder="Ключ доступа"
            autoFocus
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Войти
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-foreground">Заявки партнёров</h1>
          <button
            onClick={() => loadApplications(key)}
            className="text-xs text-muted-foreground hover:text-foreground border border-white/10 rounded px-3 py-1"
          >
            Обновить
          </button>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Загрузка...</p>}
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!loading && !error && applications.length === 0 && (
          <p className="text-sm text-muted-foreground">Нет активных заявок.</p>
        )}

        <div className="flex flex-col gap-4">
          {applications.map((app) => {
            const form = forms[app.id] ?? defaultForm(app);
            const isOpen = activeId === app.id;
            const result = results[app.id];
            return (
              <div key={app.id} className="rounded-lg border border-white/10 bg-white/5 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-medium text-foreground text-sm">{app.name}</span>
                    {app.organization && <span className="text-xs text-muted-foreground">{app.organization}</span>}
                    <span className="text-xs text-muted-foreground">{app.email} {app.phone && `· ${app.phone}`}</span>
                    <span className="text-xs text-muted-foreground capitalize">{app.partner_type.replace(/_/g, ' ')}</span>
                    {app.message && <p className="text-xs text-muted-foreground mt-1 italic">&ldquo;{app.message}&rdquo;</p>}
                    {app.jira_issue_url && (
                      <a href={app.jira_issue_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline mt-1">
                        {app.jira_issue_key}
                      </a>
                    )}
                    <span className="text-xs text-muted-foreground mt-1">{new Date(app.created_at).toLocaleDateString('ru-RU')}</span>
                  </div>
                  <button
                    onClick={() => setActiveId(isOpen ? null : app.id)}
                    className="shrink-0 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
                  >
                    {isOpen ? 'Свернуть' : 'Одобрить'}
                  </button>
                </div>

                {isOpen && (
                  <div className="mt-4 border-t border-white/10 pt-4 grid grid-cols-2 gap-3 text-sm">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">Реферальный код</span>
                      <input
                        value={form.referralCode}
                        onChange={(e) => updateForm(app.id, { referralCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                        className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                        placeholder="AUTO"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">Комиссия %</span>
                      <input
                        type="number"
                        value={form.commissionRate}
                        onChange={(e) => updateForm(app.id, { commissionRate: e.target.value })}
                        className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                        min="0" max="100" step="0.5"
                      />
                    </label>

                    <label className="col-span-2 flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.clientDiscountEnabled}
                        onChange={(e) => updateForm(app.id, { clientDiscountEnabled: e.target.checked })}
                        className="rounded"
                      />
                      <span className="text-xs text-muted-foreground">Скидка для клиентов партнёра</span>
                    </label>

                    {form.clientDiscountEnabled && (
                      <>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">Тип скидки</span>
                          <select
                            value={form.clientDiscountType}
                            onChange={(e) => updateForm(app.id, { clientDiscountType: e.target.value as 'percent' | 'fixed' | '' })}
                            className="rounded border border-white/10 bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                          >
                            <option value="">Выберите...</option>
                            <option value="percent">Процент (%)</option>
                            <option value="fixed">Фиксированная сумма (₸)</option>
                          </select>
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">Размер скидки</span>
                          <input
                            type="number"
                            value={form.clientDiscountValue}
                            onChange={(e) => updateForm(app.id, { clientDiscountValue: e.target.value })}
                            className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                            placeholder={form.clientDiscountType === 'percent' ? '5' : '500'}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">Мин. заказ (₸)</span>
                          <input
                            type="number"
                            value={form.clientDiscountMinOrder}
                            onChange={(e) => updateForm(app.id, { clientDiscountMinOrder: e.target.value })}
                            className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                            placeholder="0"
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="text-xs text-muted-foreground">Макс. скидка (₸)</span>
                          <input
                            type="number"
                            value={form.clientDiscountMax}
                            onChange={(e) => updateForm(app.id, { clientDiscountMax: e.target.value })}
                            className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                            placeholder="без ограничений"
                          />
                        </label>
                      </>
                    )}

                    <label className="col-span-2 flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">Заметки</span>
                      <textarea
                        value={form.notes}
                        onChange={(e) => updateForm(app.id, { notes: e.target.value })}
                        className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-foreground outline-none focus:border-primary resize-none"
                        rows={2}
                      />
                    </label>

                    <label className="col-span-2 flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">Кто одобряет (ваш email) *</span>
                      <input
                        value={form.approvedBy}
                        onChange={(e) => updateForm(app.id, { approvedBy: e.target.value })}
                        className="rounded border border-white/10 bg-white/5 px-2 py-1 text-xs text-foreground outline-none focus:border-primary"
                        placeholder="operator@worldprime.online"
                      />
                    </label>

                    <div className="col-span-2 flex items-center gap-3">
                      <button
                        onClick={() => handleApprove(app)}
                        className="rounded-md bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                      >
                        Одобрить и создать партнёра
                      </button>
                      {result && (
                        <span className={`text-xs ${result.startsWith('Ошибка') || result.startsWith('Укажите') ? 'text-red-400' : 'text-emerald-400'}`}>
                          {result}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
