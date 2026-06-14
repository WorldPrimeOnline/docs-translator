/**
 * @jest-environment node
 */
import { resolveTransitionId, clearResolverCache } from '../resolver';

const MOCK_TRANSITIONS = [
  { id: '11', name: 'To Do' },
  { id: '21', name: 'In Progress' },
  { id: '31', name: 'Done' },
  { id: '41', name: 'In Review' },
];

beforeEach(() => {
  clearResolverCache();
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

describe('resolveTransitionId', () => {
  it('returns transition ID for matching name', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ transitions: MOCK_TRANSITIONS }),
    });

    const id = await resolveTransitionId(
      'https://wpo.atlassian.net',
      'Basic xxx',
      'WPO-1',
      'In Progress',
    );
    expect(id).toBe('21');
  });

  it('is case-insensitive', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ transitions: MOCK_TRANSITIONS }),
    });

    const id = await resolveTransitionId(
      'https://wpo.atlassian.net',
      'Basic xxx',
      'WPO-1',
      'in progress',
    );
    expect(id).toBe('21');
  });

  it('returns null and warns for unknown transition', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ transitions: MOCK_TRANSITIONS }),
    });

    const id = await resolveTransitionId(
      'https://wpo.atlassian.net',
      'Basic xxx',
      'WPO-1',
      'Nonexistent',
    );
    expect(id).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('not available'));
    warn.mockRestore();
  });

  it('returns null on API error', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 401 });
    const id = await resolveTransitionId('https://wpo.atlassian.net', 'Basic xxx', 'WPO-1', 'Done');
    expect(id).toBeNull();
  });
});
