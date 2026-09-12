import React from 'react';
import { updateFriendSettings, type FriendSocialSettings } from '@/data/friendsClient';
import FriendSettingsSheet from '@/friends/FriendSettingsSheet';
import { t } from '@/i18n';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'), ScrollView: 'ScrollView', View: 'View', Text: 'Text',
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/BottomSheetModal', () => ({ BottomSheetModal: 'BottomSheetModal' }));
jest.mock('@/components/shared/CloseButton', () => ({ CloseButton: 'CloseButton' }));
jest.mock('@/components/shared/IconGlyph', () => ({ XIcon: 'XIcon' }));
jest.mock('@/components/shared/Toast', () => ({ Toast: 'Toast' }));
jest.mock('@/friends/HourStepper', () => ({ __esModule: true, default: 'HourStepper' }));
jest.mock('@/friends/Toggle', () => ({ __esModule: true, default: 'Toggle' }));
jest.mock('@/data/friendsClient', () => ({ updateFriendSettings: jest.fn() }));
jest.mock('@/notifications/friendPush', () => ({ disableFriendPush: jest.fn(), registerFriendPush: jest.fn() }));
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (select: (s: object) => unknown) => select({ friendPushEnabled: false }),
}));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (select: (s: object) => unknown) => select({ show: jest.fn() }),
}));

const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;
let view: ReturnType<typeof TestRenderer.create>;
const save = jest.fn();
const settings: FriendSocialSettings = {
  ghostMode: false, shareDrinksWithParta: true, shareSpendWithParta: false,
  quietHoursEnabled: false, quietHoursStart: 23, quietHoursEnd: 9,
};

function spendToggle() {
  return view.root.findAllByType('Toggle').find((node: { props: { accessibilityLabel: string } }) =>
    node.props.accessibilityLabel === t.friends.shareSpendTitle,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  await act(async () => {
    view = TestRenderer.create(<FriendSettingsSheet visible settings={settings} onSaved={save} onClose={jest.fn()} />);
  });
});

afterEach(async () => { await act(async () => view.unmount()); });

test('prevents concurrent spend updates, then allows switching consent back off', async () => {
  let finishFirst!: (value: { ok: true }) => void;
  jest.mocked(updateFriendSettings).mockImplementationOnce(() =>
    new Promise((resolve) => { finishFirst = resolve; }),
  ).mockResolvedValueOnce({ ok: true });

  await act(async () => {
    const tap = spendToggle().props.onToggle;
    tap();
    tap(); // A second event can arrive before the disabled state is rendered.
  });
  expect(updateFriendSettings).toHaveBeenCalledTimes(1);
  expect(spendToggle().props.disabled).toBe(true);
  expect(spendToggle().props.value).toBe(true);

  await act(async () => finishFirst({ ok: true }));
  expect(spendToggle().props.disabled).toBe(false);
  await act(async () => spendToggle().props.onToggle());
  expect(updateFriendSettings).toHaveBeenLastCalledWith({ shareSpendWithParta: false });
  expect(spendToggle().props.value).toBe(false);
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ shareSpendWithParta: false }));
});

test('restores consent and enables retry after a failed PATCH', async () => {
  jest.mocked(updateFriendSettings).mockResolvedValueOnce({ ok: false, code: 'network_error', detail: '' });
  await act(async () => spendToggle().props.onToggle());
  expect(spendToggle().props.value).toBe(false);
  expect(spendToggle().props.disabled).toBe(false);
});
