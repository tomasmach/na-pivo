import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import CheersPill from '../CheersPill';
import { cs } from '@/i18n/cs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-reanimated', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { Text },
    cancelAnimation: jest.fn(),
    Easing: { out: (value: unknown) => value, quad: jest.fn(), cubic: jest.fn() },
    useAnimatedStyle: jest.fn((factory: () => unknown) => factory()),
    useSharedValue: jest.fn((value: unknown) => ({ value })),
    withSequence: jest.fn((...values: unknown[]) => values.at(-1)),
    withTiming: jest.fn((value: unknown) => value),
  };
});
jest.mock('@/theme/fonts', () => ({ FontScaleCap: { body: 1.3 } }));
jest.mock('@/components/shared/IconGlyph', () => ({ BeerIcon: () => null }));
jest.mock('@/utils/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('@/utils/haptics', () => ({
  fireLightImpactHaptic: jest.fn(),
  fireSuccessHaptic: jest.fn(),
}));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('@/data/privateAccountBoundary', () => {
  class PrivateAccountMutationFrozenError extends Error {}
  return {
    PrivateAccountMutationFrozenError,
    runPrivateAccountMutation: (task: () => unknown) => task(),
  };
});
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    jest.fn((selector: (state: { hapticEnabled: boolean }) => unknown) =>
      selector({ hapticEnabled: false }),
    ),
    { getState: () => ({ hapticEnabled: false }) },
  ),
}));

const reactToBeerCheckIn = jest.fn(async () => ({
  ok: false,
  code: 'offline',
  detail: 'offline',
}));
jest.mock('@/data/beerCheckinsClient', () => ({
  reactToBeerCheckIn: (...args: unknown[]) => reactToBeerCheckIn(...(args as [])),
  clearBeerCheckInReaction: jest.fn(),
}));
jest.mock('@/data/friendsClient', () => ({
  reactToActivity: jest.fn(),
  clearActivityReaction: jest.fn(),
}));

const enqueueBeerCheckInOp = jest.fn(async (): Promise<'queued' | 'storage-error'> => 'queued');
jest.mock('@/data/beerCheckinsQueue', () => ({
  enqueueBeerCheckInOp: (...args: unknown[]) => enqueueBeerCheckInOp(...(args as [])),
}));
const enqueueFriendOp = jest.fn(async (): Promise<'queued' | 'storage-error'> => 'queued');
jest.mock('@/data/friendsQueue', () => ({
  enqueueFriendOp: (...args: unknown[]) => enqueueFriendOp(...(args as [])),
  isRetriableFriendError: () => true,
}));

const showToast = jest.fn();
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  reactToBeerCheckIn.mockResolvedValue({ ok: false, code: 'offline', detail: 'offline' });
  enqueueBeerCheckInOp.mockResolvedValue('queued');
  enqueueFriendOp.mockResolvedValue('queued');
});

it('reverts an optimistic beer cheer when its retry cannot reach storage', async () => {
  enqueueBeerCheckInOp.mockResolvedValueOnce('storage-error');
  const screen = render(
    <CheersPill activityId="11111111-1111-4111-8111-111111111111" target="beerCheckIn" count={0} mine={false} />,
  );

  fireEvent.press(screen.getByLabelText(cs.friends.cheersA11y(cs.friends.cheers)));

  await waitFor(() => expect(enqueueBeerCheckInOp).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByText(cs.friends.cheers)).toBeTruthy());
  expect(
    screen.getByLabelText(cs.friends.cheersA11y(cs.friends.cheers)).props.accessibilityState,
  ).toEqual({ selected: false });
  expect(showToast).toHaveBeenCalledWith(cs.friends.reactError, expect.any(Object));
  expect(showToast).not.toHaveBeenCalledWith(cs.friends.reactQueued, expect.anything());
});

it('reverts an optimistic activity cheer when the Parta queue cannot reach storage', async () => {
  const { reactToActivity } = jest.requireMock('@/data/friendsClient') as {
    reactToActivity: jest.Mock;
  };
  reactToActivity.mockResolvedValueOnce({ ok: false, code: 'offline', detail: 'offline' });
  enqueueFriendOp.mockResolvedValueOnce('storage-error');
  const screen = render(
    <CheersPill activityId="activity-1" count={0} mine={false} />,
  );

  fireEvent.press(screen.getByLabelText(cs.friends.cheersA11y(cs.friends.cheers)));

  await waitFor(() => expect(enqueueFriendOp).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(screen.getByText(cs.friends.cheers)).toBeTruthy());
  expect(showToast).toHaveBeenCalledWith(cs.friends.reactError, expect.any(Object));
  expect(showToast).not.toHaveBeenCalledWith(cs.friends.reactQueued, expect.anything());
});
