import { fetchFriendsDashboard } from '@/data/friendsClient';
import { loadPartaPlansSnapshot, savePartaPlansSnapshot } from '@/data/friendsSnapshot';
import { fetchPartaPlans } from '@/data/partaPlansClient';

import { usePartaStore } from '../partaStore';

jest.mock('@/data/friendsClient', () => ({ fetchFriendsDashboard: jest.fn(), markFriendNotificationsRead: jest.fn() }));
jest.mock('@/data/friendsSnapshot', () => ({
  loadFriendsDashboardSnapshot: jest.fn(async () => null),
  loadPartaPlansSnapshot: jest.fn(async () => null),
  savePartaPlansSnapshot: jest.fn(async () => undefined),
  snapshotGeneration: () => 0,
}));
jest.mock('@/data/partaPlansClient', () => ({ fetchPartaPlans: jest.fn() }));

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
