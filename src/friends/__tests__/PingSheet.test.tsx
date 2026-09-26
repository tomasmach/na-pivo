import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { t } from '@/i18n';
import type { FriendProfile } from '@/data/friendsClient';
import { usePartyGroupsStore } from '@/stores/partyGroupsStore';
import AudiencePicker, { EVERYONE } from '../AudiencePicker';
import PingSheet from '../PingSheet';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../FriendMini', () => ({ friendDisplayName: (f: { nickname: string | null; displayName: string }) => f.nickname || f.displayName }));
jest.mock('../SectionHeader', () => ({ __esModule: true, default: ({ label }: { label: string }) => {
  const { Text } = jest.requireActual('react-native');
  return <Text>{label}</Text>;
} }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('@/components/shared/IconGlyph', () => ({ CheckIcon: () => null, UsersIcon: () => null, XIcon: () => null }));
jest.mock('@/components/shared/GlowButton', () => ({
  GlowButton: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => {
    const { Pressable, Text } = jest.requireActual('react-native');
    return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} onPress={disabled ? undefined : onPress}><Text>{label}</Text></Pressable>;
  },
}));

const friend = (id: string, nickname: string): FriendProfile => ({ id, nickname, displayName: '', avatarUrl: null, isPublic: true });
const friends = [friend('eva', 'eva'), friend('pepa', 'pepa'), friend('karel', 'karel'), friend('jana', 'jana')];

beforeEach(() => usePartyGroupsStore.setState({ groups: [] }));

function sheet(onSend: jest.Mock, onClose = jest.fn(), extra: { friends?: FriendProfile[]; ghost?: boolean } = {}) {
  return render(<PingSheet title={t.friends.shareHereShort} detail={t.friends.pingSheetDetail('U Pinkasů')} friends={extra.friends ?? friends} ghost={extra.ghost} onSend={onSend} onClose={onClose} />);
}

it('pings the whole party by default, once per double tap, and closes once it went out', async () => {
  const onSend = jest.fn(async () => null);
  const onClose = jest.fn();
  const screen = sheet(onSend, onClose);
  expect(screen.getByText(t.friends.pingSheetDetail('U Pinkasů'))).toBeTruthy();
  expect(screen.getByText(t.friends.recipientAllSummary(4))).toBeTruthy();
  // A quick sheet: no heading kicker and no group naming that would need the keyboard.
  expect(screen.queryByText(t.friends.composeAudienceLabel)).toBeNull();
  await act(async () => {
    fireEvent.press(screen.getByText(t.friends.composeSubmitNow));
    fireEvent.press(screen.getByText(t.friends.composeSubmitNow));
  });
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledWith(undefined);
  expect(onClose).toHaveBeenCalled();
});

it('sends only to the friends picked, and keeps the sheet open on a hard error', async () => {
  const onSend = jest.fn(async () => 'Nikdo z party.');
  const onClose = jest.fn();
  const screen = sheet(onSend, onClose);
  fireEvent.press(screen.getByLabelText(t.friends.recipientCustom));
  // Picking starts from nobody, so there is nothing to send yet.
  expect(screen.getByLabelText(t.friends.composeSubmitNow).props.accessibilityState).toEqual({ disabled: true });
  fireEvent.press(screen.getByLabelText('eva'));
  expect(screen.getByText(t.friends.recipientCustomSummary(1))).toBeTruthy();
  expect(screen.queryByPlaceholderText(t.friends.recipientGroupPlaceholder)).toBeNull();
  await act(async () => { fireEvent.press(screen.getByText(t.friends.composeSubmitNow)); });
  expect(onSend).toHaveBeenCalledWith(['eva']);
  expect(screen.getByText('Nikdo z party.')).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
  // Nobody picked: nothing to send.
  fireEvent.press(screen.getByLabelText('eva'));
  expect(screen.getByLabelText(t.friends.composeSubmitNow).props.accessibilityState).toEqual({ disabled: true });
});

it('offers saved groups and sends to their members still in the party', async () => {
  usePartyGroupsStore.setState({ groups: [{ id: 'g1', name: 'Pátek', memberIds: ['jana', 'gone'] }] as never });
  const onSend = jest.fn(async () => null);
  const screen = sheet(onSend);
  fireEvent.press(screen.getByLabelText('Pátek'));
  await act(async () => { fireEvent.press(screen.getByText(t.friends.composeSubmitNow)); });
  expect(onSend).toHaveBeenCalledWith(['jana']);
});

it('says why nothing can go out in invisible mode or with an empty party, and holds while sending', async () => {
  const ghost = sheet(jest.fn(), jest.fn(), { ghost: true });
  expect(ghost.getByText(t.friends.pingSheetGhost)).toBeTruthy();
  expect(ghost.getByLabelText(t.friends.composeSubmitNow).props.accessibilityState).toEqual({ disabled: true });
  const empty = sheet(jest.fn(), jest.fn(), { friends: [] });
  expect(empty.getByText(t.friends.recipientNoFriends)).toBeTruthy();
  expect(empty.getByLabelText(t.friends.composeSubmitNow).props.accessibilityState).toEqual({ disabled: true });

  let finish: (value: string | null) => void = () => undefined;
  const onClose = jest.fn();
  const sending = sheet(jest.fn(() => new Promise<string | null>((resolve) => { finish = resolve; })), onClose);
  fireEvent.press(sending.getByText(t.friends.composeSubmitNow));
  fireEvent.press(sending.getByLabelText(t.friends.settingsClose));
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { finish('Nikdo z party.'); });
  expect(sending.getByText('Nikdo z party.')).toBeTruthy();
});

it('saves a group in the full compose only once it has a name and someone in it', () => {
  const Host = () => {
    const [value, setValue] = React.useState(EVERYONE);
    return <AudiencePicker friends={friends} value={value} onChange={setValue} />;
  };
  const screen = render(<Host />);
  fireEvent.press(screen.getByLabelText(t.friends.recipientCustom));
  const save = () => screen.getByLabelText(t.friends.recipientGroupSave).props.accessibilityState;
  fireEvent.press(screen.getByLabelText('eva'));
  expect(save()).toEqual({ disabled: true });
  fireEvent.changeText(screen.getByPlaceholderText(t.friends.recipientGroupPlaceholder), 'Pátek');
  expect(save()).toEqual({ disabled: false });
});

it('never drops people from saved groups when shown only part of the party', () => {
  usePartyGroupsStore.setState({ groups: [{ id: 'g1', name: 'Kluci', memberIds: ['eva', 'pepa'], updatedAt: '' }, { id: 'g2', name: 'Jen Pepa', memberIds: ['pepa'], updatedAt: '' }] });
  // Pepa walks along, so the sheet lists everyone but him.
  sheet(jest.fn(), jest.fn(), { friends: friends.filter((friend) => friend.id !== 'pepa') });
  expect(usePartyGroupsStore.getState().groups.map((group) => group.memberIds)).toEqual([['eva', 'pepa'], ['pepa']]);
});
