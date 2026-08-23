import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import RsvpControl from '../RsvpControl';
import { cs } from '@/i18n/cs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: jest.requireActual('react-native').View },
  cancelAnimation: jest.fn(),
  Easing: { out: (value: unknown) => value, cubic: jest.fn() },
  Extrapolation: { CLAMP: 'clamp' },
  interpolate: jest.fn(() => 0),
  interpolateColor: jest.fn(() => '#000'),
  useAnimatedStyle: jest.fn((factory: () => unknown) => factory()),
  useSharedValue: jest.fn((value: unknown) => ({ value })),
  withTiming: jest.fn((value: unknown) => value),
}));
jest.mock('@/utils/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('@/utils/haptics', () => ({
  fireLightImpactHaptic: jest.fn(),
  fireSuccessHaptic: jest.fn(),
}));
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ hapticEnabled: false }) },
}));
jest.mock('@/data/privateAccountBoundary', () => {
  class PrivateAccountMutationFrozenError extends Error {}
  return {
    PrivateAccountMutationFrozenError,
    runPrivateAccountMutation: (task: () => unknown) => task(),
  };
});

const respondToActivity = jest.fn();
jest.mock('@/data/friendsClient', () => ({
  respondToActivity: (...args: unknown[]) => respondToActivity(...(args as [])),
  clearActivityResponse: jest.fn(),
}));
const enqueueFriendOp = jest.fn(async () => 'queued');
jest.mock('@/data/friendsQueue', () => ({
  enqueueFriendOp: (...args: unknown[]) => enqueueFriendOp(...(args as [])),
  isRetriableFriendError: () => true,
}));
const showToast = jest.fn();
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));

it('serializes taps until the direct response and durable fallback settle', async () => {
  let resolveDirect!: (result: { ok: false; code: string }) => void;
  respondToActivity.mockReturnValueOnce(new Promise((resolve) => {
    resolveDirect = resolve;
  }));
  const screen = render(
    <RsvpControl activityId="activity-1" myResponse={null} onResponded={jest.fn()} />,
  );

  const going = screen.getByLabelText(cs.friends.rsvpGoing);
  fireEvent.press(going);
  fireEvent.press(going);

  expect(respondToActivity).toHaveBeenCalledTimes(1);
  expect(going.props.accessibilityState.disabled).toBe(true);
  await act(async () => resolveDirect({ ok: false, code: 'offline' }));
  expect(enqueueFriendOp).toHaveBeenCalledTimes(1);
});
