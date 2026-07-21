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
