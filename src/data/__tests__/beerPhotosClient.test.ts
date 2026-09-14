/**
 * Tests for the beer-photos client (src/data/beerPhotosClient.ts) — the
 * data/logic layer only. Collaborators are mocked so each test is deterministic
 * and never touches the network or native modules:
 *  - backendConfig.getBackendEndpoint/getBackendUrl → 'https://api.test'
 *    (overridable to null/'' to exercise the dormant-endpoint paths).
 *  - account.ensureAccount → a fake session so we can assert the bearer token;
 *    clearCachedAnonymousAccount → a spy (the 401 path must hit it).
 *  - expo-file-system: the upload uses the native multipart uploader
 *    (File.upload), not the global fetch. `__upload`/`__ctor` expose the spies.
 *
 * Focus: the multipart wire shape (field `image`, snake_case `parameters`),
 * the queue keep/drop classification (ok / retry / permanent-error), and the
 * wire→app mapping including absolute image-URL resolution.
 */

import {
  beerPhotoFromWire,
  deleteBeerPhoto,
  deleteBeerPhotoByClientId,
  fetchFriendBeerPhotos,
  fetchMyBeerPhotos,
  resolveBeerPhotoUrl,
  uploadBeerPhoto,
  type BeerPhotoUploadFields,
} from '@/data/beerPhotosClient';
import { clearCachedAnonymousAccount, ensureAccount } from '@/data/account';
import { getBackendEndpoint, getBackendUrl } from '@/data/backendConfig';
import {
  clearUgcConsentStateForTests,
  subscribeUgcConsentRequired,
  UGC_POLICY_HEADER,
} from '@/data/ugcConsent';
import * as efs from 'expo-file-system';

jest.mock('@/data/backendConfig', () => ({
  getBackendEndpoint: jest.fn((path: string) => `https://api.test${path}`),
  getBackendUrl: jest.fn(() => 'https://api.test'),
}));

jest.mock('@/data/account', () => ({
  ensureAccount: jest.fn(async () => ({
    deviceId: 'd',
    accountId: 'a',
    token: 'cur-tok',
    authenticated: false,
  })),
  clearCachedAnonymousAccount: jest.fn(),
}));

jest.mock('@/data/telemetryClient', () => ({ trackApiFailure: jest.fn() }));

jest.mock('expo-file-system', () => {
  const upload = jest.fn();
  const ctor = jest.fn();
  class File {
    upload = upload;
    constructor(...uris: string[]) {
      ctor(...uris);
    }
  }
  return { File, UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 }, __upload: upload, __ctor: ctor };
});

const mockGetBackendEndpoint = getBackendEndpoint as jest.MockedFunction<typeof getBackendEndpoint>;
const mockGetBackendUrl = getBackendUrl as jest.MockedFunction<typeof getBackendUrl>;
const mockEnsureAccount = ensureAccount as jest.MockedFunction<typeof ensureAccount>;
const mockClearCachedAnonymousAccount =
  clearCachedAnonymousAccount as jest.MockedFunction<typeof clearCachedAnonymousAccount>;
const mockFileUpload = (efs as unknown as { __upload: jest.Mock }).__upload;
const mockFileCtor = (efs as unknown as { __ctor: jest.Mock }).__ctor;
const ORIGINAL_FETCH = global.fetch;

const WIRE_PHOTO = {
  id: 'p1',
  client_id: 'c1',
  image_url: 'https://cdn.test/beer-photos/p1.jpg',
  caption: 'Večer u Palmy',
  pub_cache_key: 'u2fkbnhq',
  pub_name: 'U Palmy',
  pub_city: 'Brno',
  visibility: 'friends',
  taken_at: '2026-07-01T19:00:00.000Z',
  created_at: '2026-07-01T19:00:05.000Z',
  in_contest: true,
};

const APP_PHOTO = {
  id: 'p1',
  clientId: 'c1',
  imageUrl: 'https://cdn.test/beer-photos/p1.jpg',
  caption: 'Večer u Palmy',
  pubCacheKey: 'u2fkbnhq',
  pubName: 'U Palmy',
  pubCity: 'Brno',
  visibility: 'friends',
  takenAt: '2026-07-01T19:00:00.000Z',
  createdAt: '2026-07-01T19:00:05.000Z',
  inContest: true,
};

const FIELDS: BeerPhotoUploadFields = {
  clientId: 'c1',
  caption: 'Večer u Palmy',
  pubCacheKey: 'u2fkbnhq',
  pubName: 'U Palmy',
  pubCity: 'Brno',
  partyCode: 'PIVOXY',
  visibility: 'friends',
  takenAt: '2026-07-01T19:00:00.000Z',
};

/** Resolve File.upload to a {status, body, headers} result like the native module. */
function uploadResolving(status: number, body: unknown): void {
  mockFileUpload.mockResolvedValue({
    status,
    body: body === undefined ? '' : JSON.stringify(body),
    headers: {},
  });
}

/** Resolve global.fetch like the WinterCG fetch: text() then JSON.parse. */
function fetchResolving(status: number, body: unknown): jest.Mock {
  const spy = jest.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  }));
  global.fetch = spy as unknown as typeof fetch;
  return spy;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetBackendEndpoint.mockImplementation((path: string) => `https://api.test${path}`);
  mockGetBackendUrl.mockReturnValue('https://api.test');
  mockEnsureAccount.mockResolvedValue({
    deviceId: 'd',
    accountId: 'a',
    token: 'cur-tok',
    authenticated: false,
  });
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe('beerPhotoFromWire / resolveBeerPhotoUrl', () => {
  it('maps snake_case wire fields to the camelCase app shape', () => {
    expect(beerPhotoFromWire(WIRE_PHOTO)).toEqual(APP_PHOTO);
  });

  it('defaults missing fields (never throws) and treats unknown visibility as private', () => {
    expect(beerPhotoFromWire({ visibility: 'everyone' })).toEqual({
      id: '',
      clientId: '',
      imageUrl: '',
      caption: '',
      pubCacheKey: '',
      pubName: '',
      pubCity: '',
      visibility: 'private',
      takenAt: '',
      createdAt: '',
      inContest: false,
    });
  });

  it('keeps an already-absolute image_url untouched', () => {
    expect(resolveBeerPhotoUrl('https://cdn.test/x.jpg')).toBe('https://cdn.test/x.jpg');
  });

  it('prefixes a relative image_url with the backend base', () => {
    expect(resolveBeerPhotoUrl('/media/beer-photos/p1.jpg')).toBe(
      'https://api.test/media/beer-photos/p1.jpg',
    );
    expect(resolveBeerPhotoUrl('media/p1.jpg')).toBe('https://api.test/media/p1.jpg');
  });

  it('resolves to empty string for missing/non-string values', () => {
    expect(resolveBeerPhotoUrl(null)).toBe('');
    expect(resolveBeerPhotoUrl(undefined)).toBe('');
    expect(resolveBeerPhotoUrl('')).toBe('');
  });
});

describe('uploadBeerPhoto', () => {
  it('uploads via the native multipart uploader with field `image`, bearer and snake_case parameters', async () => {
    uploadResolving(201, { photo: WIRE_PHOTO });

    const result = await uploadBeerPhoto('file:///tmp/beer.jpg', FIELDS);

    expect(result).toEqual({ status: 'ok', photo: APP_PHOTO });
    expect(mockFileCtor).toHaveBeenCalledWith('file:///tmp/beer.jpg');
    const [url, opts] = mockFileUpload.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://api.test/v1/beer-photos');
    expect(opts.httpMethod).toBe('POST');
    expect(opts.uploadType).toBe(efs.UploadType.MULTIPART);
    expect(opts.fieldName).toBe('image');
    expect(opts.mimeType).toBe('image/jpeg');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer cur-tok');
    expect(opts.parameters).toEqual({
      client_id: 'c1',
      caption: 'Večer u Palmy',
      pub_cache_key: 'u2fkbnhq',
      pub_name: 'U Palmy',
      pub_city: 'Brno',
      party_code: 'PIVOXY',
      visibility: 'friends',
      taken_at: '2026-07-01T19:00:00.000Z',
    });
  });

  it('sends empty strings for omitted optional pub fields', async () => {
    uploadResolving(201, { photo: WIRE_PHOTO });

    await uploadBeerPhoto('file:///tmp/beer.jpg', {
      clientId: 'c1',
      caption: '',
      visibility: 'private',
      takenAt: '2026-07-01T19:00:00.000Z',
    });

    const [, opts] = mockFileUpload.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts.parameters).toEqual({
      client_id: 'c1',
      caption: '',
      pub_cache_key: '',
      pub_name: '',
      pub_city: '',
      party_code: '',
      visibility: 'private',
      taken_at: '2026-07-01T19:00:00.000Z',
    });
  });

  it('maps 400 → permanent-error with the backend code', async () => {
    uploadResolving(400, { detail: 'Album je plné.', code: 'photo_limit_reached' });

    const result = await uploadBeerPhoto('file:///tmp/beer.jpg', FIELDS);

    expect(result).toEqual({ status: 'permanent-error', code: 'photo_limit_reached' });
  });

  it('maps 401 → retry and clears the cached anonymous account', async () => {
    uploadResolving(401, { detail: 'nope' });

    const result = await uploadBeerPhoto('file:///tmp/beer.jpg', FIELDS);

    expect(result).toEqual({ status: 'retry' });
    expect(mockClearCachedAnonymousAccount).toHaveBeenCalledTimes(1);
  });

  it('maps 429 and 5xx → retry', async () => {
    uploadResolving(429, { detail: 'Moc rychle.' });
    expect(await uploadBeerPhoto('file:///tmp/beer.jpg', FIELDS)).toEqual({ status: 'retry' });

    uploadResolving(503, { detail: 'boom' });
    expect(await uploadBeerPhoto('file:///tmp/beer.jpg', FIELDS)).toEqual({ status: 'retry' });
  });

  it('maps a rejected upload (network/timeout) → retry and never throws', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    mockFileUpload.mockRejectedValue(abortError);

    const result = await uploadBeerPhoto('file:///tmp/beer.jpg', FIELDS);

    expect(result).toEqual({ status: 'retry' });
  });

  it('returns retry and never uploads when no backend endpoint is configured', async () => {
    mockGetBackendEndpoint.mockReturnValue(null);

    const result = await uploadBeerPhoto('file:///tmp/beer.jpg', FIELDS);

    expect(result).toEqual({ status: 'retry' });
    expect(mockFileUpload).not.toHaveBeenCalled();
  });

  it('returns retry and never uploads when no account session is available', async () => {
    mockEnsureAccount.mockResolvedValueOnce(null);

    const result = await uploadBeerPhoto('file:///tmp/beer.jpg', FIELDS);

    expect(result).toEqual({ status: 'retry' });
    expect(mockFileUpload).not.toHaveBeenCalled();
  });
});

describe('UGC policy header gating for uploads', () => {
  beforeEach(() => {
    clearUgcConsentStateForTests();
  });

  it('a friends native upload carries the canonical UGC policy header (2026-08-22)', async () => {
    uploadResolving(201, { photo: WIRE_PHOTO });

    await uploadBeerPhoto('file:///tmp/beer.jpg', FIELDS);

    const [, opts] = mockFileUpload.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts.headers).toEqual(
      expect.objectContaining({
        Authorization: 'Bearer cur-tok',
        [UGC_POLICY_HEADER]: '2026-08-22',
      }),
    );
  });

  it('a private native upload has NO UGC policy header (private path stays private)', async () => {
    uploadResolving(201, { photo: WIRE_PHOTO });

    await uploadBeerPhoto('file:///tmp/beer.jpg', { ...FIELDS, visibility: 'private' });

    const [, opts] = mockFileUpload.mock.calls[0] as [string, Record<string, unknown>];
    expect(opts.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer cur-tok' }));
    expect((opts.headers as Record<string, string>)[UGC_POLICY_HEADER]).toBeUndefined();
  });

  it('GET my photos stays header-free', async () => {
    const spy = fetchResolving(200, { photos: [] });

    await fetchMyBeerPhotos();

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toEqual(expect.objectContaining({ Authorization: 'Bearer cur-tok' }));
    expect((init.headers as Record<string, string>)[UGC_POLICY_HEADER]).toBeUndefined();
  });

  it('DELETE photo stays header-free', async () => {
    const spy = fetchResolving(204, undefined);

    await deleteBeerPhoto('p1');

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer cur-tok');
    expect((init.headers as Record<string, string>)[UGC_POLICY_HEADER]).toBeUndefined();
  });
});

describe('UGC consent retry contract for uploads (HTTP 428)', () => {
  const ugc428Bodies: { name: string; body: Record<string, unknown>; expectedSignal: string | null }[] =
    [
      { name: 'bare 428 without a semantic body code', body: {}, expectedSignal: null },
      {
        name: '428 with ugc_consent_required',
        body: { code: 'ugc_consent_required', detail: 'Potřebujeme souhlas.' },
        expectedSignal: 'ugc_consent_required',
      },
      {
        name: '428 with ugc_policy_update_required',
        body: { code: 'ugc_policy_update_required', detail: 'Pravidla se změnila.' },
        expectedSignal: 'ugc_policy_update_required',
      },
    ];

  beforeEach(() => {
    clearUgcConsentStateForTests();
  });

  it.each(ugc428Bodies)(
    'classifies a friends upload rejected with $name as retry, never permanent-error',
    async ({ body, expectedSignal }) => {
      // Pins the REAL HTTP parser: the native upload resolves a bare HTTP
      // response and classifyQueueHttpFailure must map any 428 to 'retry' —
      // a consent/policy gate is transient, so a queued photo is kept.
      const signals: string[] = [];
      subscribeUgcConsentRequired((event) => signals.push(event.code));
      uploadResolving(428, body);

      const result = await uploadBeerPhoto('file:///tmp/beer.jpg', FIELDS);

      expect(result).toEqual({ status: 'retry' });
      expect(result).not.toEqual({ status: 'permanent-error', code: expect.anything() });
      // A semantic gate emits exactly one consent signal; bare/malformed none.
      expect(signals).toEqual(expectedSignal === null ? [] : [expectedSignal]);
    },
  );
});

describe('fetchMyBeerPhotos', () => {
  it('GETs /v1/beer-photos with the bearer token and maps the photos', async () => {
    const spy = fetchResolving(200, { photos: [WIRE_PHOTO] });

    const photos = await fetchMyBeerPhotos();

    expect(photos).toEqual([APP_PHOTO]);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/beer-photos');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer cur-tok');
  });

  it('returns [] for a body without a photos array and null on HTTP failure', async () => {
    fetchResolving(200, {});
    expect(await fetchMyBeerPhotos()).toEqual([]);

    fetchResolving(500, { detail: 'boom' });
    expect(await fetchMyBeerPhotos()).toBeNull();
  });
});

describe('deleteBeerPhoto', () => {
  it('DELETEs /v1/beer-photos/<id> and returns ok on 204', async () => {
    const spy = fetchResolving(204, undefined);

    const result = await deleteBeerPhoto('p1');

    expect(result).toEqual({ ok: true });
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.test/v1/beer-photos/p1');
    expect(init.method).toBe('DELETE');
  });

  it('surfaces the backend error envelope', async () => {
    fetchResolving(404, { detail: 'Fotka neexistuje.', code: 'not_found' });

    const result = await deleteBeerPhoto('p1');

    expect(result).toEqual({ ok: false, code: 'not_found', detail: 'Fotka neexistuje.' });
  });
});

describe('deleteBeerPhotoByClientId', () => {
  it('uses the durable idempotent by-client endpoint', async () => {
    const fetchSpy = fetchResolving(204, undefined);

    await expect(deleteBeerPhotoByClientId('client/1')).resolves.toBe(true);

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.test/v1/beer-photos/by-client/client%2F1',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer cur-tok' }),
      }),
    );
  });

  it('keeps every failure retryable, including an older backend 404', async () => {
    fetchResolving(404, { code: 'photo_not_found' });

    await expect(deleteBeerPhotoByClientId('c1')).resolves.toBe(false);
  });

  it('accepts cleanup-pending because the privacy tombstone is already durable', async () => {
    fetchResolving(503, {
      code: 'photo_cleanup_pending',
      detail: 'Fotka je skrytá, soubor ještě uklízíme.',
    });

    await expect(deleteBeerPhotoByClientId('c1')).resolves.toBe(true);
  });
});

describe('fetchFriendBeerPhotos', () => {
  it('GETs the friend gallery with an encoded public id', async () => {
    const spy = fetchResolving(200, { photos: [WIRE_PHOTO] });

    const photos = await fetchFriendBeerPhotos('friend/1');

    expect(photos).toEqual([APP_PHOTO]);
    expect((spy.mock.calls[0] as [string])[0]).toBe(
      'https://api.test/v1/friends/friend%2F1/beer-photos',
    );
  });

  it('returns null when not allowed (404) or offline', async () => {
    fetchResolving(404, { detail: 'nope' });
    expect(await fetchFriendBeerPhotos('pid')).toBeNull();

    mockGetBackendEndpoint.mockReturnValue(null);
    expect(await fetchFriendBeerPhotos('pid')).toBeNull();
  });
});
