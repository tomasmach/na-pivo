import type { Pub } from '@/data/pubs';
import {
  dedupePubs,
  mergePickPubResults,
  pickPubRowMeta,
  pubMatchesTerm,
} from '@/party/pickPubModel';

const pub = (extra: Partial<Pub> = {}): Pub => ({
  id: 'p1',
  name: 'U Kotvy',
  lat: 50.08,
  lng: 14.42,
  city: 'Praha',
  ...extra,
});

describe('pick pub model', () => {
  it('writes distance, open state and the first tap with its price', () => {
    const meta = pickPubRowMeta(
      pub({ isOpenNow: true, beers: [{ name: 'Plzeň 12°', priceCzk: 59 }] }),
      40,
    );
    expect(meta.startsWith('40 m · ')).toBe(true);
    expect(meta.endsWith(' · Plzeň 12° · 59 Kč')).toBe(true);
  });

  it('skips what it does not know', () => {
    const meta = pickPubRowMeta(pub({ beers: [{ name: 'Kozel 11°' }] }), null);
    expect(meta.endsWith('Kozel 11°')).toBe(true);
    expect(meta.includes('Kč')).toBe(false);
  });

  it('matches names without diacritics or case, and by city', () => {
    expect(pubMatchesTerm(pub(), 'kotv')).toBe(true);
    expect(pubMatchesTerm(pub(), 'KOTVY')).toBe(true);
    expect(pubMatchesTerm(pub({ name: 'Lokál Dlouhááá' }), 'dlouha')).toBe(true);
    expect(pubMatchesTerm(pub(), 'praha')).toBe(true);
    expect(pubMatchesTerm(pub(), '  ')).toBe(false);
  });

  it('keeps one row per pub across sources, and two pubs of the same name apart', () => {
    const rows = dedupePubs([
      pub({ id: 'local-1', name: 'U Pinkasů', lat: 50.08237, lng: 14.42274 }),
      pub({ id: 'google-1', name: 'U Pinkasu', lat: 50.08241, lng: 14.4228 }),
      pub({ id: 'google-2', name: 'U Pinkasů', lat: 50.12, lng: 14.5 }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['local-1', 'google-2']);
  });

  it('merges local hits with suggestions, drops junk coordinates and caps after the merge', () => {
    const rows = mergePickPubResults(
      [pub({ id: 'local-1', name: 'U Pinkasů', lat: 50.08237, lng: 14.42274 })],
      [
        { id: 's-dup', name: 'U Pinkasů', lat: 50.0824, lng: 14.4228 },
        { id: 's-nolatlng', name: 'Bez polohy' },
        { id: 's-junk', name: 'Nesmysl', lat: 250, lng: 14.4 },
        { id: 's-new', name: 'Restaurace U Pinkasů', lat: 50.0818, lng: 14.4225, city: 'Praha', placeId: 'g1' },
        { id: 's-third', name: 'Pinkasova', lat: 50.1, lng: 14.5 },
      ],
      { lat: 50.0876, lng: 14.4211 },
      2,
    );
    expect(rows.map((row) => row.pub.id)).toEqual(['local-1', 's-new']);
    expect(rows[1].pub).toMatchObject({ city: 'Praha', googlePlaceId: 'g1' });
    expect(rows[0].distanceMeters).toBeGreaterThan(500);
    expect(rows[0].distanceMeters).toBeLessThan(700);
    expect(mergePickPubResults([], [], null, 5)).toEqual([]);
  });
});
