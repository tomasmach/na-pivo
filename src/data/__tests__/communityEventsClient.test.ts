import {
  createCommunityEvent,
  fetchCommunityEvents,
  requestCommunityEventJoin,
} from '../communityEventsClient';
import { ensureAccount } from '../account';

jest.mock('../account', () => ({ ensureAccount: jest.fn() }));
jest.mock('../telemetryClient', () => ({ trackApiFailure: jest.fn() }));

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const RAW_EVENT = {
  id: 'event-1',
  host: { id: 'host-1', nickname: 'host', display_name: 'Host' },
  title: 'Pivo a deskovky',
  description: 'Komorní večer.',
  city: 'Praha',
  area_label: 'Vinohrady',
  starts_at: '2026-07-20T18:00:00.000Z',
  ends_at: '2026-07-20T22:00:00.000Z',
  capacity: 6,
  available_spots: 5,
  adults_only: true,
  status: 'upcoming',
  distance_band: '1_3_km',
  is_host: false,
  membership_status: null,
  exact_address: null,
};

beforeEach(() => {
  process.env.EXPO_PUBLIC_BACKEND_URL = 'https://api.example.com';
  (ensureAccount as jest.Mock).mockResolvedValue({
    deviceId: 'device',
    accountId: 'account',
    token: 'secret',
    authenticated: true,
  });
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_URL === undefined) delete process.env.EXPO_PUBLIC_BACKEND_URL;
  else process.env.EXPO_PUBLIC_BACKEND_URL = ORIGINAL_URL;
  jest.clearAllMocks();
});

describe('community events client', () => {
  it('parses coarse discovery without inventing a private address', async () => {
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ nearby: [RAW_EVENT], hosted: [], joined: [] }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await fetchCommunityEvents({ lat: 50.075123, lng: 14.438765 });

    expect(result).toMatchObject({
      ok: true,
      dashboard: {
        nearby: [{ areaLabel: 'Vinohrady', distanceBand: '1_3_km', exactAddress: null }],
      },
    });
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/community-events/discover');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ lat: 50.075123, lng: 14.438765 });
  });

  it('sends exact location only in the explicit host-create request', async () => {
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ ...RAW_EVENT, is_host: true, exact_address: 'Testovací 12' }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await createCommunityEvent({
      clientId: 'client-1',
      title: 'Pivo a deskovky',
      description: 'Komorní večer.',
      city: 'Praha',
      areaLabel: 'Vinohrady',
      exactAddress: 'Testovací 12',
      lat: 50.0755,
      lng: 14.4378,
      startsAt: '2026-07-20T18:00:00.000Z',
      endsAt: '2026-07-20T22:00:00.000Z',
      capacity: 6,
    });

    expect(result).toMatchObject({ ok: true, event: { exactAddress: 'Testovací 12' } });
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      exact_address: 'Testovací 12',
      lat: 50.0755,
      lng: 14.4378,
      adults_confirmed: true,
    });
  });

  it('requires a claimed session and preserves a server safety error', async () => {
    (ensureAccount as jest.Mock).mockResolvedValueOnce({
      token: 'anonymous',
      authenticated: false,
    });
    global.fetch = jest.fn() as unknown as typeof fetch;
    await expect(requestCommunityEventJoin('event-1')).resolves.toMatchObject({
      ok: false,
      code: 'auth',
    });
    expect(global.fetch).not.toHaveBeenCalled();

    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 409,
      text: async () => JSON.stringify({ code: 'capacity_full', detail: 'Kapacita je plná.' }),
    })) as unknown as typeof fetch;
    await expect(requestCommunityEventJoin('event-1')).resolves.toEqual({
      ok: false,
      code: 'capacity_full',
      detail: 'Kapacita je plná.',
    });
  });
});
