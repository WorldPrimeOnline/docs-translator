/**
 * @jest-environment node
 */
import {
  notifyOperatorNewOrder,
  notifyTranslatorNewAssignment,
  notifyNotaryNewAssignment,
  notifyOperatorError,
} from '../client';

const FAKE_TOKEN = 'fake_bot_token';
const FAKE_CHAT = '12345';

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
  process.env.TELEGRAM_OPERATOR_CHAT_ID = FAKE_CHAT;
  process.env.TELEGRAM_TRANSLATOR_CHAT_ID = FAKE_CHAT;
  process.env.TELEGRAM_NOTARY_CHAT_ID = FAKE_CHAT;
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

afterEach(() => {
  jest.resetAllMocks();
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_OPERATOR_CHAT_ID;
  delete process.env.TELEGRAM_TRANSLATOR_CHAT_ID;
  delete process.env.TELEGRAM_NOTARY_CHAT_ID;
});

function captureLastMessage(): string {
  const calls = (global.fetch as jest.Mock).mock.calls;
  if (!calls.length) return '';
  const lastCall = calls[calls.length - 1];
  const body = JSON.parse(lastCall[1].body as string) as { text: string };
  return body.text;
}

describe('PII redaction', () => {
  const JOB_ID = 'abcdef00-1234-5678-9012-000000000000';

  it('operator new order does NOT include delivery phone', async () => {
    await notifyOperatorNewOrder({
      jobId: JOB_ID,
      serviceLevel: 'notarization_through_partners',
      sourceLang: 'kk',
      targetLang: 'ru',
      documentType: 'passport_id',
      notaryCity: 'almaty',
      fulfillmentMethod: 'delivery',
      wpoUrl: 'https://wpotranslations.org/dashboard',
    });
    const msg = captureLastMessage();
    expect(msg).not.toContain('+7');
    expect(msg).not.toContain('phone');
    expect(msg).not.toContain('address');
    expect(msg).toContain(JOB_ID.slice(0, 8));
  });

  it('notary assignment does NOT include delivery address', async () => {
    await notifyNotaryNewAssignment({
      jobId: JOB_ID,
      sourceLang: 'en',
      targetLang: 'ru',
      notaryCity: 'almaty',
      fulfillmentMethod: 'delivery',
    });
    const msg = captureLastMessage();
    expect(msg).not.toContain('ул.');
    expect(msg).not.toContain('delivery address');
  });

  it('does not include document content', async () => {
    await notifyTranslatorNewAssignment({
      jobId: JOB_ID,
      sourceLang: 'kk',
      targetLang: 'ru',
      documentType: 'passport_id',
    });
    const msg = captureLastMessage();
    // Only metadata — no full text
    expect(msg.length).toBeLessThan(500);
  });

  it('error notification does not expose job context beyond safe fields', async () => {
    await notifyOperatorError({
      jobId: JOB_ID,
      error: 'Connection refused',
      context: 'drive_folder_creation',
    });
    const msg = captureLastMessage();
    expect(msg).toContain('Connection refused');
    expect(msg).toContain(JOB_ID.slice(0, 8));
    expect(msg).not.toContain(JOB_ID); // only first 8 chars exposed
  });
});

describe('graceful no-op when token is not set', () => {
  beforeEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  it('does not throw and does not call fetch', async () => {
    await expect(
      notifyOperatorNewOrder({
        jobId: 'any-id',
        serviceLevel: 'electronic',
        sourceLang: 'en',
        targetLang: 'ru',
        documentType: 'other',
        wpoUrl: 'https://wpotranslations.org',
      }),
    ).resolves.toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
