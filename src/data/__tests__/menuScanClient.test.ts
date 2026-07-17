/**
 * Tests for the menu-scan client (src/data/menuScanClient.ts) — the data/logic
 * layer only. Collaborators are mocked so each test is deterministic and never
 * touches the network or native modules:
 *  - backendConfig.getBackendEndpoint → 'https://api.test' + path (overridable to
 *    null to exercise the dormant-endpoint path).
 *  - account.ensureAccount → a fake session so we can assert the bearer token.
 *  - expo-file-system: the scan upload uses the native multipart uploader
 *    (File.upload) rather than the global fetch, because Expo SDK 56's WinterCG
 *    fetch rejects the legacy RN {uri,name,type} FormData part. `__upload`/`__ctor`
 *    expose the spies.
 */

import { scanMenuPhoto } from '@/data/menuScanClient';
import { ensureAccount } from '@/data/account';
import { getBackendEndpoint } from '@/data/backendConfig';
import * as efs from 'expo-file-system';

jest.mock('@/data/backendConfig', () => ({
  getBackendEndpoint: jest.fn((path: string) => `https://api.test${path}`),
}));

jest.mock('@/data/account', () => ({
  ensureAccount: jest.fn(async () => ({
    deviceId: 'd',
    accountId: 'a',
    token: 'cur-tok',
    authenticated: false,
  })),
}));

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
const mockEnsureAccount = ensureAccount as jest.MockedFunction<typeof ensureAccount>;
const mockFileUpload = (efs as unknown as { __upload: jest.Mock }).__upload;
const mockFileCtor = (efs as unknown as { __ctor: jest.Mock }).__ctor;

/** Resolve File.upload to a {status, body, headers} result like the native module. */
function uploadResolving(status: number, body: unknown): void {
  mockFileUpload.mockResolvedValue({
    status,
    body: body === undefined ? '' : JSON.stringify(body),
    headers: {},
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetBackendEndpoint.mockImplementation((path: string) => `https://api.test${path}`);
  mockEnsureAccount.mockResolvedValue({
    deviceId: 'd',
    accountId: 'a',
    token: 'cur-tok',
    authenticated: false,
  });
});

describe('scanMenuPhoto', () => {
  it('uploads via the native multipart uploader and maps WireBeer → CommunityBeer, capping at 12', async () => {
    // 15 beers (so the 12-cap trims it) with a mix of legible / null fields.
    const beers = Array.from({ length: 15 }, (_, i) => ({
      name: `Pivo ${i + 1}`,
      price_czk: i % 2 === 0 ? 50 + i : null,
      volume_ml: i % 3 === 0 ? 500 : null,
    }));
    uploadResolving(200, { beers, model: 'gpt-vision-test' });

    const result = await scanMenuPhoto('file:///tmp/menu.jpg');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.beers).toHaveLength(12);
    expect(result.drinks).toHaveLength(12);
    expect(result.drinks[0].drinkType).toBe('beer');
    expect(result.model).toBe('gpt-vision-test');
    // First beer: even index → price present, index 0 → volume present.
    expect(result.beers[0]).toEqual({ name: 'Pivo 1', priceCzk: 50, volumeMl: 500 });
    // Second beer: odd index → null price dropped, index 1 → null volume dropped.
    expect(result.beers[1]).toEqual({ name: 'Pivo 2' });

    // File constructed from the local URI; upload targets the scan endpoint as a
    // multipart POST with field `image` and the current bearer token.
    expect(mockFileCtor).toHaveBeenCalledWith('file:///tmp/menu.jpg');
    const [url, opts] = mockFileUpload.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('https://api.test/v1/pub-menu-scan');
    expect(opts.httpMethod).toBe('POST');
    expect(opts.uploadType).toBe(efs.UploadType.MULTIPART);
    expect(opts.fieldName).toBe('image');
    expect(opts.mimeType).toBe('image/jpeg');
    expect((opts.headers as Record<string, string>).Authorization).toBe('Bearer cur-tok');
  });

  it('maps categorized soft drinks and shots while retaining legacy beers', async () => {
    uploadResolving(200, {
      beers: [{ name: 'Plzeň', price_czk: 62, volume_ml: 500 }],
      drinks: [
        { drink_type: 'beer', name: 'Plzeň', price_czk: 62, volume_ml: 500 },
        { drink_type: 'soft_drink', name: 'Kofola', price_czk: 49, volume_ml: 400 },
        { drink_type: 'shot', name: 'Slivovice', price_czk: 65, volume_ml: 40 },
        { drink_type: 'wine', name: 'Ryzlink', price_czk: 70, volume_ml: 200 },
      ],
    });

    const result = await scanMenuPhoto('file:///tmp/menu.jpg');

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.beers).toEqual([{ name: 'Plzeň', priceCzk: 62, volumeMl: 500 }]);
    expect(result.drinks).toEqual([
      { drinkType: 'beer', name: 'Plzeň', priceCzk: 62, volumeMl: 500 },
      { drinkType: 'soft_drink', name: 'Kofola', priceCzk: 49, volumeMl: 400 },
      { drinkType: 'shot', name: 'Slivovice', priceCzk: 65, volumeMl: 40 },
      { drinkType: 'wine', name: 'Ryzlink', priceCzk: 70, volumeMl: 200 },
    ]);
  });

  it('returns {empty} when the backend detects no beers (200 with beers: [])', async () => {
    uploadResolving(200, { beers: [], model: 'gpt-vision-test' });

    const result = await scanMenuPhoto('file:///tmp/menu.jpg');

    expect(result).toEqual({ status: 'empty' });
  });

  it('returns {empty} when every returned beer has an unusable name', async () => {
    uploadResolving(200, { beers: [{ name: '   ' }, { price_czk: 40 }] });

    const result = await scanMenuPhoto('file:///tmp/menu.jpg');

    expect(result).toEqual({ status: 'empty' });
  });

  it('maps 503 → unavailable', async () => {
    uploadResolving(503, { detail: 'AI teď nejede.', code: 'vision_unavailable' });

    const result = await scanMenuPhoto('file:///tmp/menu.jpg');

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('maps 503 daily_cap → daily-cap', async () => {
    uploadResolving(503, { detail: 'Dnes už stačilo.', code: 'daily_cap' });

    const result = await scanMenuPhoto('file:///tmp/menu.jpg');

    expect(result).toEqual({ status: 'daily-cap' });
  });

  it('maps 429 → rate-limited', async () => {
    uploadResolving(429, { detail: 'Moc rychle.' });

    const result = await scanMenuPhoto('file:///tmp/menu.jpg');

    expect(result).toEqual({ status: 'rate-limited' });
  });

  it('maps 400 → bad-image and surfaces the code', async () => {
    uploadResolving(400, { detail: 'Špatný obrázek.', code: 'image_invalid' });

    const result = await scanMenuPhoto('file:///tmp/menu.jpg');

    expect(result).toEqual({ status: 'bad-image', code: 'image_invalid' });
  });

  it('maps an unexpected non-2xx status → error', async () => {
    uploadResolving(500, { detail: 'boom' });

    const result = await scanMenuPhoto('file:///tmp/menu.jpg');

    expect(result).toEqual({ status: 'error' });
  });

  it('returns error (and never throws) when the upload rejects', async () => {
    mockFileUpload.mockRejectedValue(new Error('Unsupported FormDataPart implementation'));

    const result = await scanMenuPhoto('file:///tmp/menu.jpg');

    expect(result).toEqual({ status: 'error' });
  });

  it('returns error and never uploads when no backend endpoint is configured', async () => {
    mockGetBackendEndpoint.mockReturnValue(null);

    const result = await scanMenuPhoto('file:///tmp/menu.jpg');

    expect(result).toEqual({ status: 'error' });
    expect(mockFileUpload).not.toHaveBeenCalled();
  });

  it('returns error and never uploads when no account session is available', async () => {
    mockEnsureAccount.mockResolvedValueOnce(null);

    const result = await scanMenuPhoto('file:///tmp/menu.jpg');

    expect(result).toEqual({ status: 'error' });
    expect(mockFileUpload).not.toHaveBeenCalled();
  });
});
