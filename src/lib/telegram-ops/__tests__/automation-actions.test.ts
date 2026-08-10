import { forwardActionToJiraAutomation } from '../automation-actions';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
  jest.restoreAllMocks();
});

describe('forwardActionToJiraAutomation', () => {
  it('returns ok:false without calling fetch when the webhook URL is not configured', async () => {
    delete process.env.JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL;
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await forwardActionToJiraAutomation({
      issueKey: 'WO-1', action: 'translator_claim', telegramUserId: '1', executorName: 'A', role: 'translator',
    });

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs the action payload with the secret header when configured', async () => {
    process.env.JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL = 'https://automation.example/hook';
    process.env.JIRA_AUTOMATION_ACTION_WEBHOOK_SECRET = 'shh';
    const fetchSpy = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await forwardActionToJiraAutomation({
      issueKey: 'WO-123', action: 'translator_start', telegramUserId: '42', executorName: 'Aigerim', role: 'translator',
    });

    expect(result.ok).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith('https://automation.example/hook', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-Automation-Webhook-Token': 'shh' }),
    }));
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>;
    expect(body).toEqual({
      issueKey: 'WO-123', action: 'translator_start', telegramUserId: '42', executorName: 'Aigerim', role: 'translator',
    });
  });

  it('returns ok:false on non-2xx response, with the response status surfaced for logging', async () => {
    process.env.JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL = 'https://automation.example/hook';
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' }) as unknown as typeof fetch;

    const result = await forwardActionToJiraAutomation({
      issueKey: 'WO-1', action: 'notary_done', telegramUserId: '1', executorName: 'A', role: 'notary',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('500');
    expect(result.httpStatus).toBe(500);
  });

  it('returns ok:false and httpStatus:null when fetch throws', async () => {
    process.env.JIRA_AUTOMATION_TELEGRAM_ACTION_WEBHOOK_URL = 'https://automation.example/hook';
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const result = await forwardActionToJiraAutomation({
      issueKey: 'WO-1', action: 'notary_claim', telegramUserId: '1', executorName: 'A', role: 'notary',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe('network down');
    expect(result.httpStatus).toBeNull();
  });
});
