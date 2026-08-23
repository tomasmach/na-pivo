import {
  fetchActivePubEvents,
  isPubEventActive,
  submitPubEventSuggestion,
} from '../pubEventsClient';

jest.mock('../backendConfig', () => ({
  getBackendEndpoint: (path: string) => `https://api.example.test${path}`,
}));
jest.mock('../account', () => ({
  ensureAccount: jest.fn(),
  clearCachedAnonymousAccount: jest.fn(),
}));

const { ensureAccount } = jest.requireMock('../account') as { ensureAccount: jest.Mock };

const ORIGINAL_FETCH = global.fetch;

import {
  UGC_POLICY_HEADER,
  clearUgcConsentStateForTests,
  subscribeUgcConsentRequired,
} from '../ugcConsent';

describe('pubEventsClient', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    global.fetch = jest.fn();
  });

  it('keeps only valid active verified wire records', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-19T18:00:00Z'));
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        events: [
          {
            id: 'active',
            title: 'Kvíz',
            details: '',
            starts_at: '2026-07-19T17:00:00Z',
            ends_at: '2026-07-19T20:00:00Z',
            verified_at: '2026-07-19T16:00:00Z',
          },
          {
            id: 'stale',
            title: 'Staré',
            details: '',
            starts_at: '2026-07-19T14:00:00Z',
            ends_at: '2026-07-19T17:00:00Z',
            verified_at: '2026-07-19T13:00:00Z',
          },
          { id: 'broken' },
        ],
      }),
    });

    const result = await fetchActivePubEvents('u2fkbnhz');

    expect(result?.map((event) => event.id)).toEqual(['active']);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.test/v1/pub-events?cache_key=u2fkbnhz',
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    jest.restoreAllMocks();
  });

  it('does not submit with an anonymous device session', async () => {
    ensureAccount.mockResolvedValue({ token: 'secret', authenticated: false });

    const result = await submitPubEventSuggestion({
      clientId: 'client-id',
      name: 'U Tří píp',
      lat: 50.08,
      lng: 14.42,
      title: 'Kvíz',
      startsAt: '2026-07-19T17:00:00Z',
      endsAt: '2026-07-19T20:00:00Z',
    });

    expect(result).toBe('auth-required');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('submits an authenticated suggestion as additive snake-case JSON', async () => {
    ensureAccount.mockResolvedValue({ token: 'secret', authenticated: true });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 201 });

    const result = await submitPubEventSuggestion({
      clientId: 'client-id',
      name: 'U Tří píp',
      lat: 50.08,
      lng: 14.42,
      title: 'Kvíz',
      startsAt: '2026-07-19T17:00:00Z',
      endsAt: '2026-07-19T20:00:00Z',
    });

    expect(result).toBe('ok');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.test/v1/pub-events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret' }),
        body: expect.stringContaining('"client_id":"client-id"'),
      }),
    );
  });

  it('uses an end-exclusive active window', () => {
    const event = {
      id: 'event',
      title: 'Kvíz',
      details: '',
      startsAt: '2026-07-19T17:00:00Z',
      endsAt: '2026-07-19T20:00:00Z',
      verifiedAt: '2026-07-19T16:00:00Z',
    };
    expect(isPubEventActive(event, Date.parse(event.startsAt))).toBe(true);
    expect(isPubEventActive(event, Date.parse(event.endsAt))).toBe(false);
  });
});

describe('UGC policy contract', () => {
  const UGC_428_CODES = ['ugc_consent_required', 'ugc_policy_update_required'] as const;

  const suggestion = {
    clientId: 'client-id',
    name: 'U Tří píp',
    lat: 50.08,
    lng: 14.42,
    title: 'Kvíz',
    startsAt: '2026-07-19T17:00:00Z',
    endsAt: '2026-07-19T20:00:00Z',
  };

  beforeEach(() => {
    clearUgcConsentStateForTests();
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
  });

  it('authenticated submit POST carries the canonical UGC policy header', async () => {
    ensureAccount.mockResolvedValue({ token: 'secret', authenticated: true });
    (global.fetch as jest.Mock).mockResolvedValue({ ok: true, status: 201 });

    await submitPubEventSuggestion(suggestion);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.test/v1/pub-events',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ [UGC_POLICY_HEADER]: '2026-08-22' }),
      }),
    );
  });

  it('GET carries no UGC policy header', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] }),
    });

    await fetchActivePubEvents('u2fkbnhz');

    const [, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string> | undefined)?.[UGC_POLICY_HEADER]).toBeUndefined();
  });

  it('anonymous submit still makes no request', async () => {
    ensureAccount.mockResolvedValue({ token: 'secret', authenticated: false });

    await expect(submitPubEventSuggestion(suggestion)).resolves.toBe('auth-required');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it.each(UGC_428_CODES)(
    'submit on semantic 428 (%s) returns retry and emits exactly one consent signal',
    async (code) => {
      ensureAccount.mockResolvedValue({ token: 'secret', authenticated: true });
      const signals: string[] = [];
      subscribeUgcConsentRequired((event) => signals.push(event.code));
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 428,
        json: async () => ({ code, detail: 'Potřebujeme aktuální souhlas.' }),
      });

      await expect(submitPubEventSuggestion(suggestion)).resolves.toBe('retry');
      expect(signals).toEqual([code]);
    },
  );

  it.each([400, 422])('submit keeps %s permanent-error without a consent signal', async (status) => {
    ensureAccount.mockResolvedValue({ token: 'secret', authenticated: true });
    const signals: string[] = [];
    subscribeUgcConsentRequired((event) => signals.push(event.code));
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status,
      json: async () => ({}),
    });

    await expect(submitPubEventSuggestion(suggestion)).resolves.toBe('permanent-error');
    expect(signals).toEqual([]);
  });
});
