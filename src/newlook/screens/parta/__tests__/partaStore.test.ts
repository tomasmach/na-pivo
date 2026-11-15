import { fetchFriendsDashboard } from '@/data/friendsClient';
import { loadPartaPlansSnapshot, savePartaPlansSnapshot } from '@/data/friendsSnapshot';
import { fetchPartaPlans, fetchPartaPulse } from '@/data/partaPlansClient';

import { PARTA_FULL_LOAD_MS, usePartaStore } from '../partaStore';

jest.mock('@/data/friendsClient', () => ({ fetchFriendsDashboard: jest.fn(), markFriendNotificationsRead: jest.fn() }));
jest.mock('@/data/friendsSnapshot', () => ({
  loadFriendsDashboardSnapshot: jest.fn(async () => null),
  loadPartaPlansSnapshot: jest.fn(async () => null),
  saveFriendsDashboardSnapshot: jest.fn(async () => undefined),
  savePartaPlansSnapshot: jest.fn(async () => undefined),
  snapshotGeneration: () => 0,
}));
jest.mock('@/data/partaPlansClient', () => ({ fetchPartaPlans: jest.fn(), fetchPartaPulse: jest.fn() }));

const flush = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  usePartaStore.setState({ dashboard: null, plans: null, loading: false, failed: false });
});

it('reload fetches again after a load that was already running', async () => {
  let finishFirst!: () => void;
  (fetchFriendsDashboard as jest.Mock).mockResolvedValue(null);
  (fetchPartaPlans as jest.Mock)
    .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = () => resolve([]))))
    .mockResolvedValueOnce([{ id: 'new-plan' }]);

  const first = usePartaStore.getState().load();
  const second = usePartaStore.getState().reload();
  await flush();
  finishFirst();
  await Promise.all([first, second]);

  expect(fetchPartaPlans).toHaveBeenCalledTimes(2);
  expect(usePartaStore.getState().plans).toEqual([{ id: 'new-plan' }]);
});

it('shows saved invitations at once and fresh ones without waiting for the dashboard', async () => {
  let finishDashboard!: () => void;
  let finishPlans!: () => void;
  (loadPartaPlansSnapshot as jest.Mock).mockResolvedValueOnce([{ id: 'saved-plan' }]);
  (fetchFriendsDashboard as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => (finishDashboard = () => resolve(null))));
  (fetchPartaPlans as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => (finishPlans = () => resolve([{ id: 'fresh-plan' }]))));

  const loading = usePartaStore.getState().load();
  await flush();
  expect(usePartaStore.getState().plans).toEqual([{ id: 'saved-plan' }]);

  finishPlans();
  await flush();
  expect(usePartaStore.getState().plans).toEqual([{ id: 'fresh-plan' }]);
  expect(usePartaStore.getState().loading).toBe(true);
  expect(savePartaPlansSnapshot).toHaveBeenLastCalledWith([{ id: 'fresh-plan' }], 0);

  finishDashboard();
  await loading;
});

it('keeps fresh invitations when the saved copy is read after they arrive', async () => {
  let finishSnapshot!: () => void;
  (loadPartaPlansSnapshot as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => (finishSnapshot = () => resolve([{ id: 'saved-plan' }]))));
  (fetchFriendsDashboard as jest.Mock).mockResolvedValueOnce(null);
  (fetchPartaPlans as jest.Mock).mockResolvedValueOnce([{ id: 'fresh-plan' }]);

  const loading = usePartaStore.getState().load();
  await flush();
  finishSnapshot();
  await loading;

  expect(usePartaStore.getState().plans).toEqual([{ id: 'fresh-plan' }]);
});

describe('refresh while Parta is open', () => {
  const friend = { id: 'f1', displayName: 'Kuba' };
  const sitting = { account: friend, pubName: 'U Pinkasů', cacheKey: 'u2fkbn1z', beers: 2 };
  const dashboard = { friends: [friend], incomingRequests: [], notifications: [], presence: [], activeFriends: [], myActiveActivity: null };
  const live = (over: object = {}) => ({
    activeFriends: [], myActiveActivity: null, presence: [sitting], myPresence: null, homePresence: [], incomingCount: 0, unreadCount: 0, ...over,
  });
  let now = 1_000_000;

  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    (fetchFriendsDashboard as jest.Mock).mockResolvedValue(dashboard);
    (fetchPartaPlans as jest.Mock).mockResolvedValue([]);
    await usePartaStore.getState().load();
    jest.clearAllMocks();
  });
  afterEach(() => jest.restoreAllMocks());

  it('shows who sat down and a new answer from one small request', async () => {
    (fetchPartaPulse as jest.Mock).mockResolvedValueOnce({ live: live(), plans: [{ id: 'plan', responses: { going: 1 } }] });
    now += 35_000;
    await usePartaStore.getState().refresh();

    expect(fetchPartaPulse).toHaveBeenCalledTimes(1);
    expect(fetchFriendsDashboard).not.toHaveBeenCalled();
    expect(fetchPartaPlans).not.toHaveBeenCalled();
    expect(usePartaStore.getState().dashboard?.presence).toEqual([sitting]);
    expect(usePartaStore.getState().dashboard?.friends).toEqual([friend]);
    expect(usePartaStore.getState().plans).toEqual([{ id: 'plan', responses: { going: 1 } }]);
  });

  it.each([
    ['a friend request arrived', { live: live({ incomingCount: 1 }), plans: [] }],
    ['a notification arrived', { live: live({ unreadCount: 1 }), plans: [] }],
    ['the backend does not send invitations yet', { live: live(), plans: null }],
  ])('loads everything when %s', async (_case, pulse) => {
    (fetchPartaPulse as jest.Mock).mockResolvedValueOnce(pulse);
    now += 35_000;
    await usePartaStore.getState().refresh();

    expect(fetchFriendsDashboard).toHaveBeenCalledTimes(1);
    expect(fetchPartaPlans).toHaveBeenCalledTimes(1);
  });

  it('loads everything every few minutes without asking for the pulse', async () => {
    now += PARTA_FULL_LOAD_MS;
    await usePartaStore.getState().refresh();

    expect(fetchPartaPulse).not.toHaveBeenCalled();
    expect(fetchFriendsDashboard).toHaveBeenCalledTimes(1);
  });

  it('keeps what it shows when the pulse fails', async () => {
    (fetchPartaPulse as jest.Mock).mockResolvedValueOnce(null);
    now += 35_000;
    await usePartaStore.getState().refresh();

    expect(fetchFriendsDashboard).not.toHaveBeenCalled();
    expect(usePartaStore.getState().dashboard).toEqual(dashboard);
    expect(usePartaStore.getState().failed).toBe(true);
  });

  it('loads once for unread notifications older than the newest 30 and then keeps them quiet', async () => {
    (fetchPartaPulse as jest.Mock)
      .mockResolvedValueOnce({ live: live({ unreadCount: 35 }), plans: [] })
      .mockResolvedValueOnce({ live: live({ unreadCount: 5 }), plans: [] })
      .mockResolvedValueOnce({ live: live({ unreadCount: 5 }), plans: [] })
      .mockResolvedValueOnce({ live: live({ unreadCount: 5 }), plans: [] });
    for (let i = 0; i < 4; i += 1) {
      now += 35_000;
      await usePartaStore.getState().refresh();
    }

    expect(fetchPartaPulse).toHaveBeenCalledTimes(4);
    expect(fetchFriendsDashboard).toHaveBeenCalledTimes(2);
  });

  it('runs a full load asked for while a pulse is running', async () => {
    let finishPulse!: () => void;
    (fetchPartaPulse as jest.Mock).mockImplementationOnce(
      () => new Promise((resolve) => (finishPulse = () => resolve({ live: live(), plans: [] }))),
    );
    now += 35_000;
    const pulse = usePartaStore.getState().refresh();
    await flush();
    const load = usePartaStore.getState().load();
    finishPulse();
    await Promise.all([pulse, load]);

    expect(fetchFriendsDashboard).toHaveBeenCalledTimes(1);
  });
});
