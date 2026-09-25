import { fetchPublishedTours, fetchSharedTour, publishPublicTour, publishTour, searchPublicTours, shareTour, revokeTour } from '../toursClient';
import { beginTourAccountChange, endTourAccountChange } from '../toursBoundary';
import { newTour, type TourPlan } from '@/tours/model';
import { ensureAccount } from '../account';
jest.mock('../account', () => ({ ensureAccount: jest.fn(async () => ({ accountId: 'owner-a', token: 'private-bearer' })), generateUuidV4: () => '11111111-1111-4111-8111-111111111111' }));
jest.mock('../backendConfig', () => ({ getBackendEndpoint: (path: string) => `http://127.0.0.1:8012${path}` }));
const originalFetch = global.fetch;
const plan: TourPlan = { ...newTour(), title: 'Tour', stops: [1, 2].map((n) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, pubId: `pub-${n}`, cacheKey: null, name: `Pub ${n}`, address: '', lat: 50, lon: 14 })) };
const envelope = (revision = 1) => ({ tour: { id: plan.id, title: 'Tour', scheduled_date: null, scheduled_time: null, timezone: 'Europe/Prague', revision, updated_at: new Date().toISOString(), stops: plan.stops.map((s) => ({ id: s.id, pub_id: s.pubId, cache_key: s.cacheKey, name: s.name, address: s.address, lat: s.lat, lon: s.lon })) }, share: null });
const response = (status: number, data: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => data }) as Response;
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});
afterEach(() => {
  global.fetch = originalFetch;
});
it('serializes explicit publish and idempotency keys without local run/source metadata', async () => {
  jest.mocked(fetch).mockResolvedValue(response(200, envelope()));
  const result = await publishTour(plan, 'operation');
  expect(result.ok).toBe(true);
  const [url, options] = jest.mocked(fetch).mock.calls[0];
  expect(url).toBe(`http://127.0.0.1:8012/v1/tours/${plan.id}`);
  expect(JSON.parse(options!.body as string)).toEqual({ operation_id: 'operation', base_revision: 0, title: 'Tour', scheduled_date: null, scheduled_time: null, timezone: 'Europe/Prague', stops: envelope().tour.stops.map((stop) => ({ ...stop, challenge: '' })) });
  expect(options!.headers).toMatchObject({ Authorization: 'Bearer private-bearer' });
});
it('public link reads send no account bearer and reject bad tokens locally', async () => {
  jest.mocked(fetch).mockResolvedValue(response(200, { ...envelope(), expires_at: '2026-10-18T00:00:00Z' }));
  expect((await fetchSharedTour('x'.repeat(43))).ok).toBe(true);
  expect(ensureAccount).not.toHaveBeenCalled();
  expect(jest.mocked(fetch).mock.calls[0][1]!.headers).not.toHaveProperty('Authorization');
  expect(await fetchSharedTour('../secret')).toEqual({ ok: false, error: 'expired' });
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('collects all published pages, detects pagination loops', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(response(200, { tours: [envelope()], next_cursor: '50' })).mockResolvedValueOnce(response(200, { tours: [], next_cursor: null }));
  expect(await fetchPublishedTours()).toMatchObject({ ok: true, tours: [{ id: plan.id }] });
  expect(jest.mocked(fetch).mock.calls[1][0]).toBe('http://127.0.0.1:8012/v1/tours?cursor=50');
  jest.mocked(fetch).mockResolvedValue(response(200, { tours: [], next_cursor: '50' }));
  expect(await fetchPublishedTours()).toEqual({ ok: false, error: 'invalid' });
});
it('keeps conflict snapshots; handles network and auth failures without throwing', async () => {
  jest.mocked(fetch).mockResolvedValueOnce(response(409, envelope(2))).mockResolvedValueOnce(response(401, {})).mockRejectedValueOnce(new Error('offline'));
  expect(await publishTour(plan, 'id')).toMatchObject({ ok: false, error: 'conflict', tour: { revision: 2 } });
  expect(await shareTour(plan.id, 'id')).toEqual({ ok: false, error: 'auth' });
  expect(await publishTour(plan, 'id')).toEqual({ ok: false, error: 'network' });
});
it('ignores a delayed response after account change', async () => {
  let finish!: (r: Response) => void;
  let ready!: () => void;
  const started = new Promise<void>((r) => {
    ready = r;
  });
  jest.mocked(fetch).mockImplementation(() => {
    ready();
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const request = publishTour(plan, 'id');
  await started;
  beginTourAccountChange();
  finish(response(200, envelope()));
  expect(await request).toEqual({ ok: false, error: 'account_changed' });
  endTourAccountChange();
});

it('keeps the 404 meaning when a revoked public link has an empty body', async () => {
  jest.mocked(fetch).mockResolvedValue({ status: 404, ok: false, json: async () => { throw new SyntaxError('Empty body'); } } as unknown as Response);
  expect(await fetchSharedTour('x'.repeat(43))).toEqual({ ok: false, error: 'expired' });
});

it('distinguishes missing owner tours from expired public links', async () => {
  jest.mocked(fetch).mockResolvedValue(response(404, {}));
  expect(await shareTour(plan.id, 'operation')).toEqual({ ok: false, error: 'not_found' });
  expect(await revokeTour(plan.id)).toEqual({ ok: false, error: 'not_found' });
  expect(await fetchSharedTour('x'.repeat(43))).toEqual({ ok: false, error: 'expired' });
});

it('always sends a challenge key so clearing reaches the server, and reads only real challenges back', async () => {
  const withChallenge = { ...plan, stops: [{ ...plan.stops[0], challenge: 'Najdi nejstarší pípu' }, plan.stops[1]] };
  const remote = envelope();
  remote.tour.stops = remote.tour.stops.map((stop, index) => ({ ...stop, challenge: index ? '' : 'Najdi nejstarší pípu' }));
  jest.mocked(fetch).mockResolvedValue(response(200, remote));
  const result = await publishTour(withChallenge, 'operation');
  const sent = JSON.parse(jest.mocked(fetch).mock.calls[0][1]!.body as string).stops;
  expect(sent.map((stop: { challenge: string }) => stop.challenge)).toEqual(['Najdi nejstarší pípu', '']);
  expect(result.ok && result.tour.stops.map((stop) => stop.challenge)).toEqual(['Najdi nejstarší pípu', undefined]);
});

it('reads the publication of an owner tour, the author of a public link, and why publishing was refused', async () => {
  const publication = { id: '33333333-3333-4333-8333-333333333333', token: 'publicTokenForTests12', url: 'https://na-pivo.cz/t/publicTokenForTests12', status: 'active', revision: 1, plan_revision: 1, people_count: 4 };
  jest.mocked(fetch).mockResolvedValueOnce(response(200, { ...envelope(), publication }));
  const published = await publishPublicTour(plan.id, 1);
  expect(JSON.parse(jest.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ revision: 1, accept_rules: true });
  expect(published.ok && published.tour.publication).toEqual({ id: publication.id, token: publication.token, url: publication.url, status: 'active', revision: 1, planRevision: 1, peopleCount: 4 });
  jest.mocked(fetch).mockResolvedValueOnce(response(400, { error: 'text_rejected', detail: 'x', field: 'challenge', stop: 1 }));
  expect(await publishPublicTour(plan.id, 1)).toEqual({ ok: false, error: 'text_rejected', field: 'challenge', stop: 1 });
  const author = { id: 'author', nickname: 'pivni_vlk', display_name: 'Pavel', avatar_url: null };
  jest.mocked(fetch).mockResolvedValueOnce(response(200, { ...envelope(), expires_at: null, public: { id: publication.id, author, people_count: 4, city: 'Praha', walk_m: 1200 } }));
  const opened = await fetchSharedTour('publicTokenForTests12');
  expect(opened.ok && opened.public).toEqual({ id: publication.id, peopleCount: 4, city: 'Praha', walkM: 1200, author: { id: 'author', nickname: 'pivni_vlk', displayName: 'Pavel', avatarUrl: null } });
});

it('searches public tours with the position in the body and keeps only well-formed rows', async () => {
  const hit = { id: '33333333-3333-4333-8333-333333333333', token: 'publicTokenForTests12', title: 'Pátek u tygra', city: 'Praha', stop_count: 3,
    walk_m: 1200, has_challenges: true, people_count: 4, distance_m: 350, author: { id: 'a', nickname: 'pivni_vlk', display_name: '', avatar_url: null } };
  jest.mocked(fetch).mockResolvedValue(response(200, { results: [hit, { ...hit, id: 'nope' }, { ...hit, author: null }], next_page: 1, nearby: false }));
  const result = await searchPublicTours({ q: 'tygr', lat: 50.08, lon: 14.42, stops: '2-3', challenges: true });
  const [url, options] = jest.mocked(fetch).mock.calls[0];
  expect(url).toBe('http://127.0.0.1:8012/v1/tour-publications/search');
  expect(options!.method).toBe('POST');
  expect(JSON.parse(options!.body as string)).toEqual({ q: 'tygr', lat: 50.08, lon: 14.42, stops: '2-3', challenges: true });
  expect(result).toEqual({ ok: true, nextPage: 1, nearby: false, results: [{ id: hit.id, token: hit.token, title: hit.title, city: 'Praha', stopCount: 3, walkM: 1200,
    hasChallenges: true, peopleCount: 4, distanceM: 350, author: { id: 'a', nickname: 'pivni_vlk', displayName: '', avatarUrl: null } }] });

  jest.mocked(fetch).mockRejectedValue(new Error('offline'));
  expect(await searchPublicTours({})).toEqual({ ok: false, offline: true });
  jest.mocked(fetch).mockResolvedValue(response(500, null));
  expect(await searchPublicTours({})).toEqual({ ok: false, offline: false });
});
