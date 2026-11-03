import { fetchFriendsDashboard } from '@/data/friendsClient';
import { fetchPartaPlans } from '@/data/partaPlansClient';

import { usePartaStore } from '../partaStore';

jest.mock('@/data/friendsClient', () => ({ fetchFriendsDashboard: jest.fn(), markFriendNotificationsRead: jest.fn() }));
jest.mock('@/data/friendsSnapshot', () => ({ loadFriendsDashboardSnapshot: jest.fn(async () => null), snapshotGeneration: () => 0 }));
jest.mock('@/data/partaPlansClient', () => ({ fetchPartaPlans: jest.fn() }));

it('reload fetches again after a load that was already running', async () => {
  let finishFirst!: () => void;
  (fetchFriendsDashboard as jest.Mock).mockResolvedValue(null);
  (fetchPartaPlans as jest.Mock)
    .mockImplementationOnce(() => new Promise((resolve) => (finishFirst = () => resolve([]))))
    .mockResolvedValueOnce([{ id: 'new-plan' }]);

  const first = usePartaStore.getState().load();
  const second = usePartaStore.getState().reload();
  await new Promise((resolve) => setImmediate(resolve));
  finishFirst();
  await Promise.all([first, second]);

  expect(fetchPartaPlans).toHaveBeenCalledTimes(2);
  expect(usePartaStore.getState().plans).toEqual([{ id: 'new-plan' }]);
});
