import { fetchPartaPulse } from '../partaPlansClient';

jest.mock('../account', () => ({ ensureAccount: jest.fn(async () => ({ token: 'test-token' })) }));
jest.mock('../friendsSnapshot', () => ({ snapshotGeneration: () => 0, saveFriendsDashboardSnapshot: jest.fn() }));
jest.mock('../backendConfig', () => ({ getBackendEndpoint: (path: string) => `http://localhost${path}` }));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

const plan = {
  id: 'a1',
  account: { id: 'k', nickname: 'klara', display_name: 'Klára', avatar_url: null, is_public: true },
  name: 'U @klara doma',
  kind: 'plan',
  place_kind: 'home',
  scheduled_for: '2026-11-17T18:00:00Z',
  started_at: '2026-11-17T18:00:00Z',
  expires_at: '2026-11-18T06:00:00Z',
  responses: { going: 1, maybe: 0, cant: 0, going_profiles: [] },
  my_response: null,
};
const body = { presence: [], active_friends: [], incoming_count: 2, unread_count: 0, parta_plans: [plan] };

const response = (status: number, json: unknown, etag: string | null) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? etag : null) },
  text: async () => (json === undefined ? '' : JSON.stringify(json)),
});

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

it('asks with the last tag and keeps the copy it holds when nothing changed', async () => {
  const fetchMock = jest
    .fn()
    .mockResolvedValueOnce(response(200, body, 'W/"v1"'))
    .mockResolvedValueOnce(response(304, undefined, 'W/"v1"'));
  global.fetch = fetchMock as unknown as typeof fetch;

  const first = await fetchPartaPulse();
  const second = await fetchPartaPulse();

  expect(fetchMock.mock.calls[0][0]).toBe('http://localhost/v1/friends/live?view=parta');
  expect(fetchMock.mock.calls[0][1].headers['If-None-Match']).toBeUndefined();
  expect(fetchMock.mock.calls[1][1].headers['If-None-Match']).toBe('W/"v1"');
  expect(first?.live.incomingCount).toBe(2);
  expect(first?.plans?.map((p) => p.id)).toEqual(['a1']);
  expect(second).toEqual(first);
});

it('reports no invitations from a backend that does not send them yet', async () => {
  global.fetch = jest.fn().mockResolvedValueOnce(response(200, { presence: [], incoming_count: 0 }, null)) as unknown as typeof fetch;

  const pulse = await fetchPartaPulse();

  expect(pulse?.plans).toBeNull();
  expect(pulse?.live.incomingCount).toBe(0);
});
