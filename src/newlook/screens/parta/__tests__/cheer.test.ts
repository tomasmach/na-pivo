import { cheerFriend, clearFriendCheer, type FriendPresence, type FriendsDashboard } from '@/data/friendsClient';
import { enqueueFriendOp } from '@/data/friendsQueue';

import { toast } from '../../../ui/store';
import { toggleCheer } from '../cheerActions';
import { usePartaStore } from '../partaStore';

jest.mock('@/data/friendsClient', () => ({ cheerFriend: jest.fn(), clearFriendCheer: jest.fn() }));
jest.mock('@/data/friendsQueue', () => ({
  enqueueFriendOp: jest.fn(async () => undefined),
  isRetriableFriendError: (res: { code: string }) => res.code === 'network',
}));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('../../../ui/store', () => ({ toast: jest.fn() }));
jest.mock('../partaStore', () => {
  const { create } = jest.requireActual('zustand');
  return {
    usePartaStore: create((set: (s: object) => void, get: () => { dashboard: object | null }) => ({
      dashboard: null,
      setDashboard: (fn: (d: object) => object) => {
        const current = get().dashboard;
        if (current) set({ dashboard: fn(current) });
      },
    })),
  };
});

const klara = { account: { id: 'klara' }, reactions: { cheers: 2 }, myReaction: null } as unknown as FriendPresence;
const row = () => usePartaStore.getState().dashboard?.presence[0];

beforeEach(() => {
  jest.clearAllMocks();
  usePartaStore.setState({ dashboard: { presence: [klara] } as unknown as FriendsDashboard });
});

it('shows the cheer at once and keeps the count the server returns', async () => {
  (cheerFriend as jest.Mock).mockResolvedValue({ ok: true, reactions: { cheers: 3 } });

  const done = toggleCheer('klara');
  expect(row()).toMatchObject({ myReaction: 'cheers', reactions: { cheers: 3 } });
  await done;

  expect(row()).toMatchObject({ myReaction: 'cheers', reactions: { cheers: 3 } });
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'saved', title: 'Ťuk! Na zdraví.' }));
  expect(enqueueFriendOp).not.toHaveBeenCalled();
});

it('queues the cheer without signal and keeps it on screen', async () => {
  (cheerFriend as jest.Mock).mockResolvedValue({ ok: false, code: 'network', detail: 'x' });

  await toggleCheer('klara');

  expect(enqueueFriendOp).toHaveBeenCalledWith({ op: 'friend-cheer', accountId: 'klara' });
  expect(row()).toMatchObject({ myReaction: 'cheers', reactions: { cheers: 3 } });
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'offline', title: 'Nejsi online.', sub: 'Připiju, až bude signál.' }));
});

it('takes the cheer back on a second tap and reverts when the server refuses', async () => {
  usePartaStore.setState({ dashboard: { presence: [{ ...klara, myReaction: 'cheers', reactions: { cheers: 3 } }] } as unknown as FriendsDashboard });
  (clearFriendCheer as jest.Mock).mockResolvedValue({ ok: false, code: 'not_friends', detail: 'S tímhle člověkem ještě nejste parta.' });

  await toggleCheer('klara');

  expect(row()).toMatchObject({ myReaction: 'cheers', reactions: { cheers: 3 } });
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
});
