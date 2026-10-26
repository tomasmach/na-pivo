import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import ManagePartaScreen from '../profile/parta';

const mockShowToast = jest.fn();
const mockUnblockFriend = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/data/friendsClient', () => ({
  fetchFriendsDashboard: async () => null,
  fetchBlockedAccounts: async () => [
    { id: 'acc-1', nickname: 'pepa', displayName: 'Pepa', avatarUrl: null, isPublic: true },
  ],
  unblockFriend: (id: string) => mockUnblockFriend(id),
}));
jest.mock('@/data/friendsSnapshot', () => ({ loadFriendsDashboardSnapshot: async () => null }));
jest.mock('@/stores/accountStore', () => ({ useAccountStore: () => 'test-account' }));
jest.mock('@/stores/toastStore', () => ({ useToastStore: () => mockShowToast }));
jest.mock('@/friends/friendSafety', () => ({ useFriendSafety: () => jest.fn() }));
jest.mock('@/components/shared/AppDialog', () => {
  const showAppDialog = jest.fn();
  return { showAppDialog, useShowAppDialog: () => showAppDialog };
});
jest.mock('@/components/shared/IconGlyph', () => ({
  ChevronLeftIcon: () => null, ChevronRightIcon: () => null, UserPlusIcon: () => null,
}));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null, default: () => null }));
jest.mock('@/friends/CodeSheet', () => () => null);
jest.mock('@/friends/FriendListRow', () => ({ FriendListRow: () => null }));
jest.mock('@/friends/FriendsSkeleton', () => () => null);
jest.mock('@/friends/OfflineBanner', () => () => null);
jest.mock('@/friends/OutgoingInvites', () => ({ OutgoingInvites: () => null }));
jest.mock('@/friends/AddFriendTools', () => ({ AddFriendTools: () => null }));
jest.mock('@/friends/SectionHeader', () => () => null);

type DialogButton = { text: string; onPress?: () => void };

describe('Správa party blocked list', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnblockFriend.mockResolvedValue({ ok: true });
  });

  it('unblocks a person after confirmation and drops them from the list', async () => {
    const { showAppDialog } = jest.requireMock('@/components/shared/AppDialog') as {
      showAppDialog: jest.Mock;
    };
    const screen = render(<ManagePartaScreen />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    expect(screen.getByText('@pepa')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Odblokovat @pepa?'));
    expect(mockUnblockFriend).not.toHaveBeenCalled();

    const { buttons } = showAppDialog.mock.calls[0][0] as { buttons: DialogButton[] };
    await act(async () => { buttons.find((b) => b.text === 'Odblokovat')?.onPress?.(); });

    expect(mockUnblockFriend).toHaveBeenCalledWith('acc-1');
    expect(mockShowToast).toHaveBeenCalledWith('Odblokováno.');
    expect(screen.queryByText('@pepa')).toBeNull();
  });

  it('keeps the person listed when the unblock fails', async () => {
    mockUnblockFriend.mockResolvedValue({ ok: false, code: 'offline', detail: 'Bez sítě.' });
    const { showAppDialog } = jest.requireMock('@/components/shared/AppDialog') as {
      showAppDialog: jest.Mock;
    };
    const screen = render(<ManagePartaScreen />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

    fireEvent.press(screen.getByLabelText('Odblokovat @pepa?'));
    const { buttons } = showAppDialog.mock.calls[0][0] as { buttons: DialogButton[] };
    await act(async () => { buttons.find((b) => b.text === 'Odblokovat')?.onPress?.(); });

    expect(mockShowToast).toHaveBeenCalledWith('Bez sítě.');
    expect(screen.getByText('@pepa')).toBeTruthy();
  });
});
