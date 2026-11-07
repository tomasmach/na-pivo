import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { fetchFriendsDashboard } from '@/data/friendsClient';
import { geohash8 } from '@/data/geohash';

import { useTablemates } from '../tablemates';
import { usePartaStore } from '../partaStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockGeneration = 1;
jest.mock('expo-router', () => ({ useIsFocused: () => true }));
jest.mock('@/data/friendsClient', () => ({ fetchFriendsDashboard: jest.fn() }));
jest.mock('@/data/friendsSnapshot', () => ({ snapshotGeneration: () => mockGeneration }));
jest.mock('@/stores/accountStore', () => ({ useAccountStore: (select: (st: { profile: object }) => unknown) => select({ profile: {} }) }));
jest.mock('../partaStore', () => {
  const { create } = jest.requireActual('zustand');
  return { usePartaStore: create(() => ({ dashboard: null, plans: null, pingIds: [], meetups: null, generation: 1 })) };
});

const NOW = Date.parse('2026-11-07T20:00:00Z');
const PUB = { lat: 50.08237, lng: 14.42274 };
const PUB_KEY = geohash8(PUB.lat, PUB.lng);
function sitting(id: string) {
  return {
    account: { id, nickname: id, displayName: id, avatarUrl: null },
    pubName: 'U Pinkasů', pubCity: 'Praha', cacheKey: 'pub:pinkasy', ...PUB,
    since: new Date(NOW - 3600_000).toISOString(), lastSeenAt: new Date(NOW - 60_000).toISOString(),
    beers: 1, lastDrinkName: '', activityId: null,
  };
}
const dashboard = (friend: string) => ({ friends: [{ id: friend }], presence: [sitting(friend)], myPresence: { ...sitting('me'), visibleToParta: true } });

let shown: string[] = [];
function Probe() {
  shown = useTablemates(PUB_KEY, 1, NOW).map((p) => p.id);
  return null;
}

test('after an account switch the counter forgets the old crew and shows the new one', async () => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  usePartaStore.setState({ dashboard: dashboard('klara') as never, generation: 1 });
  (fetchFriendsDashboard as jest.Mock).mockResolvedValue(dashboard('jana'));
  mockGeneration = 2;
  await act(async () => {
    TestRenderer.create(<Probe />);
  });
  expect(usePartaStore.getState().generation).toBe(2);
  expect(shown).toEqual(['jana']);
});
