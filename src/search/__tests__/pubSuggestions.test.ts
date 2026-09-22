import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import type { WireVisit } from '@/data/visitsClient';
import type { TallySession } from '@/stores/tallyStore';
import { buildPubSuggestions } from '../pubSuggestions';

const position = { lat: 49.195, lng: 16.606 };
const pub = (id: string, offset = 0): Pub => ({ id, name: id, lat: position.lat + offset, lng: position.lng });
const visit = (place: Pub, id = place.id, date = '2026-09-20T18:00:00Z'): WireVisit => ({
  client_id: id, cache_key: geohash8(place.lat, place.lng), name: place.name,
  lat: place.lat, lng: place.lng, external_id: place.id, city: 'Brno',
  started_at: date, ended_at: date, updated_at: date,
});
const session = (place: Pub, id = place.id, count = 1): TallySession => ({
  clientId: id, pubKey: geohash8(place.lat, place.lng), pubName: place.name, pubExternalId: place.id,
  startedAt: '2026-09-20T18:00:00Z',
  drinks: Array.from({ length: count }, (_, i) => ({ id: `${id}-${i}`, beerName: 'Pivo', at: '2026-09-20T19:00:00Z' })),
});
const build = (overrides: Partial<Parameters<typeof buildPubSuggestions>[0]> = {}) => buildPubSuggestions({
  pubs: [], localSessions: [], serverVisits: [], position, reportedIds: [], reportedKeys: [], ...overrides,
});

it('takes the two closest and two most visited distinct pubs, counting visits rather than beers', () => {
  const pubs = [pub('far', 0.04), pub('near', 0.001), pub('frequent', 0.02), pub('nearest'), pub('many-beers', 0.03)];
  const result = build({ pubs, localSessions: [session(pubs[2], 'one'), session(pubs[2], 'two'), session(pubs[4], 'three', 20)] });
  expect(result.nearby.map((item) => item.pub.id)).toEqual(['nearest', 'near']);
  expect(result.frequent.map((item) => [item.pub.id, item.visitCount])).toEqual([['frequent', 2], ['many-beers', 1]]);
  expect(result.nearby[0].distanceMeters).toBe(0);
});

it('deduplicates the same synced evening and breaks equal visit counts by recency', () => {
  const old = pub('old'); const recent = pub('recent', 0.01);
  const result = build({ position: null, pubs: [old, recent], localSessions: [session(old, 'same', 10)],
    serverVisits: [visit(old, 'same'), visit(recent, 'new', '2026-09-21T18:00:00Z')] });
  expect(result.frequent.map((item) => [item.pub.id, item.visitCount])).toEqual([['recent', 1], ['old', 1]]);
});

it('fills all four slots from history without location and does not show distances', () => {
  const pubs = Array.from({ length: 5 }, (_, i) => pub(String(i), i * 0.01));
  const result = build({ position: null, pubs, serverVisits: pubs.map((p) => visit(p)) });
  expect(result.nearby).toEqual([]);
  expect(result.frequent).toHaveLength(4);
  expect(result.frequent.every((item) => item.distanceMeters === undefined)).toBe(true);
});

it('fills all four slots from nearby pubs without history, deduplicating ids and coordinates', () => {
  const pubs = [pub('a'), pub('same-place'), pub('a', 0.002), pub('b', 0.003), pub('c', 0.004), pub('d', 0.005)];
  const result = build({ pubs });
  expect(result.nearby).toHaveLength(4);
  expect(new Set(result.nearby.map((item) => item.pub.id)).size).toBe(4);
  expect(new Set(result.nearby.map(({ pub: p }) => geohash8(p.lat, p.lng))).size).toBe(4);
});

it('does not repeat a nearby pub in the frequent list and fills a short second section', () => {
  const pubs = [pub('a'), pub('b', 0.001), pub('c', 0.002), pub('d', 0.003)];
  const result = build({ pubs, serverVisits: [visit(pubs[0]), visit(pubs[2])] });
  expect(result.nearby.map((item) => item.pub.id)).toEqual(['a', 'b', 'd']);
  expect(result.frequent.map((item) => item.pub.id)).toEqual(['c']);
});

it('ignores catalog pubs over 10 km from the current location', () => {
  expect(build({ pubs: [pub('old-city', 1)] })).toEqual({ nearby: [], frequent: [] });
  expect(build({ pubs: [pub('unlocated')], position: null })).toEqual({ nearby: [], frequent: [] });
  expect(build()).toEqual({ nearby: [], frequent: [] });
});

it('uses map visit fallbacks when the catalog is missing', () => {
  const place = pub('missing');
  const result = build({ position: null, serverVisits: [visit(place)] });
  expect(result.frequent[0].pub).toEqual({ id: `visit:${geohash8(place.lat, place.lng)}`, name: 'missing', lat: place.lat, lng: place.lng, city: 'Brno' });
  expect(result.frequent[0].visitCount).toBe(1);
});

it.each(['id', 'key', 'not_pub', 'discovery'] as const)('never resurrects a catalog exclusion through history (%s)', (reason) => {
  const place = { ...pub('excluded'), ...(reason === 'not_pub' ? { venueKind: 'not_pub' as const } : {}),
    ...(reason === 'discovery' ? { discoveryKind: 'campsite' as const } : {}) };
  expect(build({ pubs: [place], serverVisits: [visit(place)], localSessions: [session(place, 'local')],
    reportedIds: reason === 'id' ? [place.id] : [], reportedKeys: reason === 'key' ? [geohash8(place.lat, place.lng)] : [],
  })).toEqual({ nearby: [], frequent: [] });
});

it('filters a reported external id even without a catalog row and without resurrecting its local copy', () => {
  const place = pub('reported');
  const local = { ...session(pub('old-alias', 0.01), 'synced'), pubExternalId: undefined };
  expect(build({ serverVisits: [visit(place, 'synced')], localSessions: [local], reportedIds: [place.id] })).toEqual({ nearby: [], frequent: [] });
});

it('ignores malformed local keys, outside contexts, empty evenings and invalid server coordinates', () => {
  const place = pub('invalid');
  expect(build({ localSessions: [
    { ...session(place, 'malformed'), pubKey: 'not-a-hash' },
    { ...session(place, 'outside'), pubKey: 'ctx:home' },
    { ...session(place, 'context'), placeContext: 'private' },
    session(place, 'empty', 0),
  ], serverVisits: [
    { ...visit(place, 'nan'), lat: NaN }, { ...visit(place, 'lat'), lat: 91 },
    { ...visit(place, 'lng'), lng: -181 }, { ...visit(place, 'key'), cache_key: 'ctx:home' },
  ] })).toEqual({ nearby: [], frequent: [] });
});


it('fills a short nearby section from additional history', () => {
  const pubs = [pub('near'), pub('far-one', 1), pub('far-two', 2), pub('far-three', 3)];
  const result = build({ pubs, serverVisits: pubs.slice(1).map((p) => visit(p)) });
  expect(result.nearby).toHaveLength(1);
  expect(result.frequent).toHaveLength(3);
});

it('does not revive a location-reported catalog id through older visit coordinates', () => {
  const place = pub('reported');
  const old = pub('reported', 0.01);
  expect(build({ pubs: [place], reportedKeys: [geohash8(place.lat, place.lng)], serverVisits: [visit(old)] }))
    .toEqual({ nearby: [], frequent: [] });
});
