import { act, fireEvent, render } from '@testing-library/react-native';
import { t } from '@/i18n';
import type { FriendProfile } from '@/data/friendsClient';
import { usePartyGroupsStore } from '@/stores/partyGroupsStore';
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
jest.mock('@/components/shared/IconGlyph', () => ({ CheckIcon: () => null, PlusIcon: () => null, UsersIcon: () => null, XIcon: () => null }));
jest.mock('@/components/shared/GlowButton', () => ({
  GlowButton: ({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) => {
    const { Pressable, Text } = jest.requireActual('react-native');
    return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} onPress={disabled ? undefined : onPress}><Text>{label}</Text></Pressable>;
  },
}));

const friend = (id: string, nickname: string): FriendProfile => ({ id, nickname, displayName: '', avatarUrl: null, isPublic: true });
const friends = [friend('eva', 'eva'), friend('pepa', 'pepa'), friend('karel', 'karel'), friend('jana', 'jana')];

beforeEach(() => usePartyGroupsStore.setState({ groups: [] }));

function sheet(onSend: jest.Mock, onClose = jest.fn()) {
  return render(<PingSheet title={t.friends.shareHereShort} detail={t.friends.pingSheetDetail('U Pinkasů')} friends={friends} onSend={onSend} onClose={onClose} />);
}

it('pings the whole party by default and closes once it went out', async () => {
  const onSend = jest.fn(async () => null);
  const onClose = jest.fn();
  const screen = sheet(onSend, onClose);
  expect(screen.getByText(t.friends.pingSheetDetail('U Pinkasů'))).toBeTruthy();
  expect(screen.getByText(t.friends.recipientAllSummary(4))).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByText(t.friends.composeSubmitNow)); });
  expect(onSend).toHaveBeenCalledWith(undefined);
  expect(onClose).toHaveBeenCalled();
});

it('sends only to the friends picked, and keeps the sheet open on a hard error', async () => {
  const onSend = jest.fn(async () => 'Nikdo z party.');
  const onClose = jest.fn();
  const screen = sheet(onSend, onClose);
  fireEvent.press(screen.getByLabelText(t.friends.recipientCustom));
  // "Vybrat" starts from the first three; leave only Eva.
  fireEvent.press(screen.getByLabelText('pepa'));
  fireEvent.press(screen.getByLabelText('karel'));
  expect(screen.getByText(t.friends.recipientCustomSummary(1))).toBeTruthy();
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
