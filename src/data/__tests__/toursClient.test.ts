import { fetchPublishedTours, fetchSharedTour, publishTour, shareTour, revokeTour } from '../toursClient';
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
  expect(JSON.parse(options!.body as string)).toEqual({ operation_id: 'operation', base_revision: 0, title: 'Tour', scheduled_date: null, scheduled_time: null, timezone: 'Europe/Prague', stops: envelope().tour.stops });
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
