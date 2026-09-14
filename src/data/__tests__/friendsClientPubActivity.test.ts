import {
  clearActivityReaction,
  clearActivityResponse,
  createFriendPlan,
  endFriendPubActivity,
  fetchFriendsDashboard,
  markFriendNotificationsRead,
  reactToActivity,
  respondToActivity,
  shareFriendPubActivity,
} from '../friendsClient';

import { ensureAccount, clearCachedAnonymousAccount } from '../account';
import {
  clearUgcConsentStateForTests,
  CURRENT_UGC_POLICY_VERSION,
  subscribeUgcConsentRequired,
  UGC_POLICY_HEADER,
} from '../ugcConsent';
import type { Pub } from '../pubs';

jest.mock('../account', () => ({
  ensureAccount: jest.fn(),
  clearCachedAnonymousAccount: jest.fn(async () => undefined),
  generateUuidV4: jest.fn(() => 'uuid-fixed'),
}));
jest.mock('../backendConfig', () => ({
  getBackendEndpoint: jest.fn((path: string) => `https://api.test${path}`),
}));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const PUB: Pub = { id: 'mapy:pub', name: 'U tří růží', lat: 50.08, lng: 14.42, city: 'Praha' };
const NETWORK_ERROR = { ok: false as const, code: 'network', detail: 'Síť se netváří. Zkus to za chvíli.' };

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function recordFetch(respond: (call: RecordedCall) => { ok: boolean; status: number; body?: string }): {
  calls: RecordedCall[];
  spy: jest.Mock;
} {
  const calls: RecordedCall[] = [];
  const spy = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const call: RecordedCall = { url: String(url), init: init ?? {} };
    calls.push(call);
    const res = respond(call);
    return {
      ok: res.ok,
      status: res.status,
      text: async () => res.body ?? '',
    };
  });
  global.fetch = spy as unknown as typeof fetch;
  return { calls, spy };
}

function okBody(body: unknown): { ok: boolean; status: number; body: string } {
  return { ok: true, status: 200, body: JSON.stringify(body) };
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
  (ensureAccount as jest.Mock).mockResolvedValue({
    deviceId: 'device',
    accountId: 'account-1',
    token: 'secret',
    authenticated: true,
  });
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_URL === undefined) delete process.env.EXPO_PUBLIC_BACKEND_URL;
  else process.env.EXPO_PUBLIC_BACKEND_URL = ORIGINAL_URL;
  clearUgcConsentStateForTests();
  jest.clearAllMocks();
});

describe('gated UGC authoring requests carry canonical consent headers', () => {
  it.each([
    [
      'createFriendPlan',
      () => createFriendPlan(PUB, '2026-08-23T18:00:00.000Z', '', undefined, ['friend-a']),
      ['friend-a'],
    ],
    [
      'shareFriendPubActivity',
      () => shareFriendPubActivity(PUB, undefined, undefined, ['friend-a', 'friend-b']),
      ['friend-a', 'friend-b'],
    ],
  ])('%s sends ugcPolicyHeaders even with an empty message', async (_name, act, recipients) => {
    const { calls } = recordFetch(() => okBody({}));
    await act();

    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].url).toBe('https://api.test/v1/friends/pub-activity');
    expect(calls[0].init.headers).toMatchObject({
      [UGC_POLICY_HEADER]: CURRENT_UGC_POLICY_VERSION,
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
    });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.recipient_ids).toEqual(recipients);
  });

  it('signals each semantic 428 code exactly once and preserves code + detail', async () => {
    for (const code of ['ugc_consent_required', 'ugc_policy_update_required'] as const) {
      clearUgcConsentStateForTests();
      const signals: string[] = [];
      subscribeUgcConsentRequired(({ code }) => signals.push(code));
      const { calls } = recordFetch(() => ({
        ok: false,
        status: 428,
        body: JSON.stringify({ code, detail: `detail-${code}` }),
      }));

      await expect(createFriendPlan(PUB, '2026-08-23T18:00:00.000Z')).resolves.toEqual({
        ok: false,
        code,
        detail: `detail-${code}`,
      });
      expect(calls[0].init.headers).toMatchObject({ [UGC_POLICY_HEADER]: CURRENT_UGC_POLICY_VERSION });
      expect(signals).toEqual([code]);
    }
  });

  it('falls back to http_428 without signaling on malformed, empty, bare or missing-code bodies', async () => {
    const cases: string[] = ['not json at all', '', '{}', JSON.stringify({ detail: 'no code' })];
    for (const body of cases) {
      clearUgcConsentStateForTests();
      const signals: string[] = [];
      subscribeUgcConsentRequired(({ code }) => signals.push(code));
      let textCalls = 0;
      const spy = jest.fn(async () => ({
        ok: false,
        status: 428,
        text: async () => {
          textCalls += 1;
          return body;
        },
      }));
      global.fetch = spy as unknown as typeof fetch;

      const result = await shareFriendPubActivity(PUB);

      expect(textCalls).toBe(1);
      if (body === '{}' || body === 'not json at all' || body === '') {
        expect(result).toEqual({
          ok: false,
          code: 'http_428',
          detail: 'Nepodařilo se to uložit. Zkus to znovu.',
        });
      } else {
        expect(result).toEqual({ ok: false, code: 'http_428', detail: 'no code' });
      }
      expect(signals).toEqual([]);
    }
  });

  it('returns the exact network error without calling fetch when ensureAccount rejects', async () => {
    (ensureAccount as jest.Mock).mockRejectedValue(new Error('account boom'));
    const spy = jest.fn();
    global.fetch = spy as unknown as typeof fetch;

    await expect(shareFriendPubActivity(PUB)).resolves.toEqual(NETWORK_ERROR);
    expect(spy).not.toHaveBeenCalled();
  });

  it('preserves the account-null result when ensureAccount resolves null', async () => {
    (ensureAccount as jest.Mock).mockResolvedValue(null);
    const spy = jest.fn();
    global.fetch = spy as unknown as typeof fetch;

    await expect(createFriendPlan(PUB, '2026-08-23T18:00:00.000Z')).resolves.toEqual({
      ok: false,
      code: 'account',
      detail: 'Účet teď není připravený.',
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it('on a gated 401 clears the cached anonymous account and keeps the auth copy even with a malformed body', async () => {
    recordFetch(() => ({ ok: false, status: 401, body: '{broken' }));

    await expect(shareFriendPubActivity(PUB)).resolves.toEqual({
      ok: false,
      code: 'auth',
      detail: 'Přihlášení vypršelo.',
    });
    expect(clearCachedAnonymousAccount).toHaveBeenCalledTimes(1);
  });

  it('a rejected text read on a 2xx flows to network instead of a false success', async () => {
    let textCalls = 0;
    const spy = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: () => {
        textCalls += 1;
        return Promise.reject(new Error('stream died'));
      },
    }));
    global.fetch = spy as unknown as typeof fetch;

    await expect(shareFriendPubActivity(PUB)).resolves.toEqual(NETWORK_ERROR);
    expect(textCalls).toBe(1);
  });

  it('malformed JSON text on a 2xx flows to network instead of a false success', async () => {
    let fetchCalls = 0;
    let textCalls = 0;
    const spy = jest.fn(async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        text: async () => {
          textCalls += 1;
          return 'not json at all';
        },
      };
    });
    global.fetch = spy as unknown as typeof fetch;

    await expect(shareFriendPubActivity(PUB)).resolves.toEqual(NETWORK_ERROR);
    expect(fetchCalls).toBe(1);
    expect(textCalls).toBe(1);
  });
});

const UNGATED_428_BODY = JSON.stringify({ code: 'ugc_consent_required', detail: 'consent' });

describe('reads and non-authoring actions stay header-free and signal-free', () => {
  it.each([
    ['fetchFriendsDashboard', () => fetchFriendsDashboard()],
    ['respondToActivity', () => respondToActivity('act-1', 'going')],
    ['clearActivityResponse', () => clearActivityResponse('act-1')],
    ['reactToActivity', () => reactToActivity('act-1', 'cheers')],
    ['clearActivityReaction', () => clearActivityReaction('act-1')],
    ['endFriendPubActivity', () => endFriendPubActivity('act-1')],
    ['markFriendNotificationsRead', () => markFriendNotificationsRead(['n-1'])],
  ])('%s never sends UGC headers nor signals on a semantic 428', async (_name, act) => {
    clearUgcConsentStateForTests();
    const signals: string[] = [];
    subscribeUgcConsentRequired(({ code }) => signals.push(code));
    const { calls } = recordFetch(() => ({
      ok: false,
      status: 428,
      body: UNGATED_428_BODY,
    }));

    await act();

    expect(calls).toHaveLength(1);
    const headers = calls[0].init.headers as Record<string, unknown>;
    expect(headers[UGC_POLICY_HEADER]).toBeUndefined();
    expect(headers.Authorization).toBe('Bearer secret');
    expect(signals).toEqual([]);
  });
});
