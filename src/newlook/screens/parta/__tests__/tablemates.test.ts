import type { FriendPresence, MyPresence } from '@/data/friendsClient';
import { geohash8 } from '@/data/geohash';

import { tablemates } from '../partaModel';

const NOW = Date.parse('2026-11-07T20:00:00Z');
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();
const PUB = { lat: 50.0875, lng: 14.4213 };
const PUB_KEY = geohash8(PUB.lat, PUB.lng);

function sitting(id: string, cacheKey: string, lastSeenAt = minutesAgo(5)): FriendPresence {
  return {
    account: { id, nickname: id, displayName: id, avatarUrl: null } as FriendPresence['account'],
    pubName: 'U Pinkasů',
    pubCity: 'Praha',
    cacheKey,
    ...PUB,
    since: minutesAgo(60),
    lastSeenAt,
    beers: 2,
    lastDrinkName: '',
    activityId: null,
  };
}

const me = (overrides: Partial<MyPresence> = {}): MyPresence => ({ ...sitting('me', 'pub:pinkasy'), visibleToParta: true, ...overrides });

test('friends the server sees in my pub sit with me', () => {
  const dashboard = { myPresence: me(), presence: [sitting('klara', 'pub:pinkasy'), sitting('petr', 'pub:jinde')] };
  expect(tablemates(dashboard, PUB_KEY, NOW).map((p) => p.id)).toEqual(['klara']);
});

test('nobody sits with me when the server still has me in another pub', () => {
  const dashboard = { myPresence: me({ lat: 49.19, lng: 16.6 }), presence: [sitting('klara', 'pub:pinkasy')] };
  expect(tablemates(dashboard, PUB_KEY, NOW)).toEqual([]);
});

test('a dashboard saved yesterday says nothing about tonight', () => {
  const dashboard = { myPresence: me({ lastSeenAt: minutesAgo(600) }), presence: [sitting('klara', 'pub:pinkasy', minutesAgo(600))] };
  expect(tablemates(dashboard, PUB_KEY, NOW)).toEqual([]);
});

test('a friend who left hours ago is no longer at the table', () => {
  const dashboard = { myPresence: me(), presence: [sitting('klara', 'pub:pinkasy', minutesAgo(200))] };
  expect(tablemates(dashboard, PUB_KEY, NOW)).toEqual([]);
});

test('without my own visit on the server there is no table to share', () => {
  expect(tablemates({ myPresence: null, presence: [sitting('klara', 'pub:pinkasy')] }, PUB_KEY, NOW)).toEqual([]);
});
