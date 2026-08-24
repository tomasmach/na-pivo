import React, { useState } from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import { AddFriendTools } from '@/friends/AddFriendTools';
import type { FriendProfile } from '@/data/friendsClient';

const profile: FriendProfile = {
  id: 'friend-1',
  nickname: 'pepa',
  displayName: 'Pepa',
  avatarUrl: null,
  isPublic: true,
};

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/data/friendsClient', () => ({
  fetchFriendInviteCode: jest.fn(),
  followAccount: jest.fn(),
  searchFriends: jest.fn(),
}));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: jest.Mock }) => unknown) =>
    selector({ show: jest.fn() }),
}));
jest.mock('@/components/shared/GlowButton', () => ({ GlowButton: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({
  LinkIcon: () => null,
  PlusIcon: () => null,
  QrCodeIcon: () => null,
  SearchIcon: () => null,
  UserPlusIcon: () => null,
  UsersIcon: () => null,
  XIcon: () => null,
}));
jest.mock('@/friends/FriendMini', () => ({
  FriendMini: ({ profile: friend }: { profile: FriendProfile }) => <Text>{friend.displayName}</Text>,
}));
jest.mock('@/friends/HairlineRow', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function Harness({ open }: { open: boolean }) {
  const [query, setQuery] = useState('pepa');
  const [results, setResults] = useState<FriendProfile[]>([profile]);
  if (!open) return null;
  return (
    <AddFriendTools
      hasIdentity
      needsNickname={false}
      onOpenCode={jest.fn()}
      onChanged={jest.fn()}
      showInviteActions={false}
      queryValue={query}
      resultsValue={results}
      onQueryChange={setQuery}
      onResultsChange={setResults}
    />
  );
}

describe('AddFriendTools native modal lifecycle', () => {
  it('restores the parent-owned search draft after its native host remounts', () => {
    const screen = render(<Harness open />);
    const input = screen.getByDisplayValue('pepa');
    expect(screen.getByText('Pepa')).toBeTruthy();

    fireEvent.changeText(input, 'nový dotaz');
    screen.rerender(<Harness open={false} />);
    screen.rerender(<Harness open />);

    expect(screen.getByDisplayValue('nový dotaz')).toBeTruthy();
    expect(screen.getByText('Pepa')).toBeTruthy();
  });
});
