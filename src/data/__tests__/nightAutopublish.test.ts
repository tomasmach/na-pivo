jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../nightsQueue', () => ({ enqueueNightOp: jest.fn(() => Promise.resolve()) }));

import { autopublishClosedNight } from '../nightAutopublish';
import { enqueueNightOp } from '../nightsQueue';
import { useTallyStore, type TallySession } from '@/stores/tallyStore';
import { DEFAULT_SHARING_PREFS, useVycepStore } from '@/stores/vycepStore';

const enqueue = enqueueNightOp as jest.Mock;

const night: TallySession = {
  clientId: 's-1',
  pubKey: 'u2fkbnhq',
  pubName: 'U Zlatého tygra',
  pubCity: 'Praha',
  startedAt: '2026-06-14T18:00:00.000Z',
  drinks: [
    { id: 'd-1', beerName: 'Pilsner Urquell', at: '2026-06-14T18:05:00.000Z' },
    { id: 'd-2', beerName: 'Pilsner Urquell', at: '2026-06-14T19:30:00.000Z' },
  ],
};

beforeEach(() => {
  enqueue.mockClear();
  useTallyStore.setState({ current: null, history: [night] });
  useVycepStore.setState({ published: {}, ...DEFAULT_SHARING_PREFS });
});

describe('autopublishClosedNight', () => {
  it('stays quiet until the user picks auto-publish', () => {
    autopublishClosedNight(night, 'manual');
    useVycepStore.setState({ nightAutopublish: 'off' });
    autopublishClosedNight(night, 'manual');

    expect(enqueue).not.toHaveBeenCalled();
  });

  it('queues the whole night with the chosen audience after Dopito', () => {
    useVycepStore.setState({ nightAutopublish: 'public' });

    autopublishClosedNight(night, 'manual');

    expect(enqueue).toHaveBeenCalledTimes(1);
    const op = enqueue.mock.calls[0][0];
    expect(op).toMatchObject({
      op: 'publish',
      payload: {
        clientId: 'night-2026-06-14',
        beerCount: 2,
        pubNames: ['U Zlatého tygra'],
        city: 'Praha',
        visibility: 'public',
      },
    });
    expect(useVycepStore.getState().published['night-2026-06-14']?.visibility).toBe('public');
  });

  it('never publishes on a pub change in the middle of the night', () => {
    useVycepStore.setState({ nightAutopublish: 'friends' });

    autopublishClosedNight(night, 'pub-change');

    expect(enqueue).not.toHaveBeenCalled();
  });

  it('keeps the audience of a night the user already hung up by hand', () => {
    useVycepStore.setState({ nightAutopublish: 'public' });
    useVycepStore.getState().markPublished('night-2026-06-14', 'friends');

    autopublishClosedNight(night, 'timeout');

    expect(enqueue.mock.calls[0][0].payload.visibility).toBe('friends');
  });
});
