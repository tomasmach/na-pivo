import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { useLivePartyStore } from '@/mocks/livePartyStore';

const STORAGE_KEY = 'na-pivo-live-party';

beforeEach(async () => {
  await AsyncStorage.clear();
  useLivePartyStore.setState({
    live: false,
    pubName: '',
    houseBeer: 'Pivo',
    pubKey: null,
    pickingPub: false,
    startedAt: null,
    people: [],
    photos: 0,
    games: [],
    log: [],
  });
  await AsyncStorage.clear();
});

describe('livePartyStore persistence', () => {
  it('restores the running clock, pub, guests and local game result', async () => {
    const store = useLivePartyStore.getState();
    store.start('Lokál', 'Plzeň 12°', 'u2fkbn0z');
    store.invite('Kuba');
    store.addGame('quiz', 'Pub kvíz');
    store.finishGame('quiz', {
      game: 'Pub kvíz',
      winner: 'Kuba',
      scores: [{ name: 'Kuba', score: 8 }],
    });

    const persisted = await AsyncStorage.getItem(STORAGE_KEY);
    expect(persisted).not.toBeNull();

    useLivePartyStore.setState({
      live: false,
      pubName: 'Jinde',
      houseBeer: 'Jiné',
      pubKey: null,
      startedAt: null,
      people: [],
      games: [],
      log: [],
    });
    await AsyncStorage.setItem(STORAGE_KEY, persisted as string);
    await useLivePartyStore.persist.rehydrate();

    expect(useLivePartyStore.getState()).toMatchObject({
      live: true,
      pubName: 'Lokál',
      houseBeer: 'Plzeň 12°',
      pubKey: 'u2fkbn0z',
      people: [expect.objectContaining({ name: 'Kuba' })],
      games: [
        expect.objectContaining({
          key: 'quiz',
          result: expect.objectContaining({ winner: 'Kuba' }),
        }),
      ],
    });
    expect(useLivePartyStore.getState().startedAt).not.toBeNull();
  });

  it('never invents a placeholder when the legacy photo hook has no real uri', () => {
    useLivePartyStore.getState().addPhoto();

    expect(useLivePartyStore.getState().photos).toBe(0);
    expect(useLivePartyStore.getState().log).toEqual([]);
  });

  it('keeps the just-finished local game available to its recap', () => {
    const store = useLivePartyStore.getState();
    store.start('Lokál', 'Plzeň 12°', 'u2fkbn0z');
    store.addGame('dice', 'Kostky');
    store.finishGame('dice', {
      game: 'Kostky',
      winner: 'Ty',
      scores: [{ name: 'Ty', score: 6 }],
    });

    store.end();

    expect(useLivePartyStore.getState()).toMatchObject({
      live: false,
      games: [expect.objectContaining({ key: 'dice', result: { game: 'Kostky', winner: 'Ty', scores: [{ name: 'Ty', score: 6 }] } })],
    });
    expect(useLivePartyStore.getState().startedAt).not.toBeNull();
  });
});

describe('unnamed place', () => {
  it('starts with no pub name so the picker label never becomes one', () => {
    expect(useLivePartyStore.getState().pubName).toBe('');
  });
});
