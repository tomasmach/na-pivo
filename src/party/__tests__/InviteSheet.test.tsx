import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { InviteSheet } from '@/party/InviteSheet';

jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native');
  return { ...actual, Share: { share: jest.fn(async () => ({ action: 'sharedAction' })) } };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/BottomSheetModal', () => ({
  BottomSheetModal: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    visible ? <View>{children}</View> : null,
}));
jest.mock('@/components/shared/CloseButton', () => ({ CloseButton: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({
  CheckIcon: () => null,
  CopyIcon: () => null,
}));
jest.mock('react-native-qrcode-svg', () => () => null);
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: jest.Mock }) => unknown) =>
    selector({ show: jest.fn() }),
}));

const friends = [
  { id: 'f1', nickname: null, displayName: '', avatarUrl: null },
  { id: 'f2', nickname: 'zdenek', displayName: 'Zden\u011bk', avatarUrl: null },
];

jest.mock('@/data/friendsClient', () => ({
  fetchFriendsDashboard: jest.fn(async () => ({ friends })),
}));

async function open() {
  const screen = render(
    <InviteSheet visible present={[]} code="PIVOXY" link="https://na-pivo.cz/t/PIVOXY" onClose={jest.fn()} />,
  );
  await act(async () => {
    jest.advanceTimersByTime(1);
    await Promise.resolve();
  });
  return screen;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it('names a friend without a nickname instead of leaving the row blank', async () => {
  const screen = await open();
  expect(screen.getByText('Piva\u0159')).toBeTruthy();
});

it('switches the row to a sent state after the code goes out', async () => {
  const screen = await open();
  await act(async () => {
    fireEvent.press(screen.getByLabelText('Poslat k\u00f3d: zdenek'));
    await Promise.resolve();
  });

  expect(screen.queryByLabelText('Poslat k\u00f3d: zdenek')).toBeNull();
  expect(screen.getByText('Posl\u00e1no')).toBeTruthy();
});
