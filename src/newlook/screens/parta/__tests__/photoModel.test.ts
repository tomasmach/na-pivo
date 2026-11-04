import type { PartaFeedPhoto } from '@/data/beerPhotosClient';
import type { BeerPhotoLocal } from '@/stores/beerPhotosStore';

import { partaStripPhotos, photoWhen } from '../photoModel';

const NOW = new Date(2026, 10, 4, 21, 0).getTime();
const ago = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();
const ME = { initial: 'T', name: 'Ty', short: 'Ty' };

function mine(over: Partial<BeerPhotoLocal>): BeerPhotoLocal {
  return {
    id: 'm1',
    clientId: 'c1',
    imageUrl: 'https://x/m1.jpg',
    caption: '',
    pubCacheKey: '',
    pubName: 'U Zlatého tygra',
    pubCity: 'Praha',
    visibility: 'friends',
    takenAt: ago(1),
    createdAt: ago(1),
    inContest: false,
    beerName: 'Pilsner Urquell 12°',
    ...over,
  } as BeerPhotoLocal;
}

function theirs(id: string, hours: number, displayName: string): PartaFeedPhoto {
  return {
    id,
    clientId: id,
    imageUrl: `https://x/${id}.jpg`,
    caption: 'Kdo dorazí, má u mě rundu.',
    pubCacheKey: '',
    pubName: 'Lokál Dlouhááá',
    pubCity: 'Praha',
    visibility: 'friends',
    takenAt: ago(hours),
    createdAt: ago(hours),
    inContest: false,
    beerName: 'Čokoládový porter',
    account: { nickname: 'marek', displayName, avatarUrl: null },
  };
}

it('puts my shared photos from the last week among the party ones, newest first', () => {
  const strip = partaStripPhotos(
    [theirs('k1', 3, 'Klára na čepu'), theirs('m2', 0.5, 'Marek štamgast')],
    [mine({}), mine({ id: 'old', clientId: 'old', takenAt: ago(24 * 8) }), mine({ id: 'secret', clientId: 'secret', visibility: 'private' })],
    NOW,
    ME,
  );

  expect(strip.map((p) => [p.key, p.author.short])).toEqual([
    ['m2', 'Marek'],
    ['m1', 'Ty'],
    ['k1', 'Klára'],
  ]);
  expect(strip[0]).toMatchObject({ title: 'Čokoládový porter', pubName: 'Lokál Dlouhááá', author: { name: 'Marek štamgast', initial: 'M' } });
});

it('is empty without photos, so the strip hides', () => {
  expect(partaStripPhotos([], [mine({ visibility: 'private' })], NOW, ME)).toEqual([]);
});

it('says when a photo was taken the way the design does', () => {
  const now = new Date(NOW);
  expect(photoWhen(new Date(2026, 10, 4, 20, 41).toISOString(), now)).toMatch(/^dnes 20:41$/);
  expect(photoWhen(new Date(2026, 10, 3, 22, 5).toISOString(), now)).toMatch(/^včera 22:05$/);
});
