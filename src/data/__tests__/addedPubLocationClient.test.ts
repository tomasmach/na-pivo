import { lookupAddedPubLocation } from '../addedPubLocationClient';

jest.mock('../account', () => ({ clearCachedAnonymousAccount: jest.fn() }));
jest.mock('../backendConfig', () => ({
  getBackendEndpoint: (path: string) => `http://127.0.0.1:8012${path}`,
}));

const originalFetch = global.fetch;
const input = { address: 'Česká 12', city: 'Brno' };
const addressItem = {
  type: 'regional.address',
  precise: true,
  position: { lat: 49.1951, lon: 16.6068 },
  regionalStructure: [
    { type: 'regional.street', name: ' Česká 12 ' },
    { type: 'regional.municipality', name: ' Brno ' },
  ],
};
let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [addressItem] }) });
  global.fetch = fetchMock as typeof fetch;
});

afterEach(() => { global.fetch = originalFetch; });

it('normalizes an address-level result and sends city with no GPS bias', async () => {
  await expect(lookupAddedPubLocation(input)).resolves.toEqual({
    lat: 49.1951, lng: 16.6068, address: 'Česká 12', city: 'Brno',
  });
  expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8012/v1/pubs/geocode', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ query: 'Česká 12, Brno', address_lookup: true }),
  }));
});

it('uses the reverse endpoint only when the user supplies a GPS fix', async () => {
  await lookupAddedPubLocation({ lat: 48.1486, lng: 17.1077 });
  expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8012/v1/pubs/reverse-geocode', expect.objectContaining({
    body: JSON.stringify({ lat: 48.1486, lng: 17.1077, require_precise: true }),
  }));
});

it.each([
  ['an older server without precision confirmation', { ...addressItem, precise: undefined }],
  ['an imprecise reverse result', { ...addressItem, precise: false }],
  ['a town centroid', { ...addressItem, type: 'regional.municipality' }],
  ['an invalid latitude', { ...addressItem, position: { lat: 91, lon: 16 } }],
  ['an invalid longitude', { ...addressItem, position: { lat: 49, lon: -181 } }],
  ['a numeric string', { ...addressItem, position: { lat: '49.1951', lon: 16 } }],
  ['missing city', { ...addressItem, regionalStructure: [addressItem.regionalStructure[0]] }],
  ['missing street', { ...addressItem, regionalStructure: [addressItem.regionalStructure[1]] }],
  ['blank address', { ...addressItem, regionalStructure: [
    { type: 'regional.street', name: ' ' }, addressItem.regionalStructure[1],
  ] }],
])('rejects %s without substituting a location', async (_label, item) => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ items: [item] }) });
  await expect(lookupAddedPubLocation(input)).resolves.toBeNull();
});

it.each([
  ['offline', () => { throw new TypeError('Network request failed'); }],
  ['HTTP failure', () => ({ ok: false, status: 503 })],
  ['malformed JSON', () => ({ ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } })],
  ['unexpected response', () => ({ ok: true, json: async () => ({ items: {} }) })],
])('returns no location for %s', async (_label, response) => {
  fetchMock.mockImplementation(response);
  await expect(lookupAddedPubLocation(input)).resolves.toBeNull();
});

it.each([{ address: '', city: 'Brno' }, { address: 'Česká 12', city: '' }])(
  'does not query without both address and city (%j)', async (incomplete) => {
    await expect(lookupAddedPubLocation(incomplete)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  },
);

it('does not truncate the town out of an overlong query', async () => {
  await expect(lookupAddedPubLocation({ address: 'A'.repeat(150), city: 'Brno' })).resolves.toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('does not start a lookup already cancelled by an address edit', async () => {
  const request = new AbortController();
  request.abort();
  await expect(lookupAddedPubLocation(input, request.signal)).resolves.toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
});
