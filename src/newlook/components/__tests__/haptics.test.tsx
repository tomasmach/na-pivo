import React from 'react';

import { useSettingsStore } from '@/stores/settingsStore';
import { fireSelectionHaptic } from '@/utils/haptics';

import { Press, Toggle } from '../ui';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('@/utils/haptics', () => ({ fireSelectionHaptic: jest.fn() }));
jest.mock('../Icon', () => ({ Icon: () => null }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  ...jest.requireActual('react-native-reanimated'),
  interpolateColor: () => '#000000',
}));
jest.mock('../../motion', () => ({ DURATION: {}, enterTiming: () => ({}), fadeInTiming: () => ({}) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer');

function tap(element: React.ReactElement, role: string) {
  let renderer: any;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(element);
  });
  const target = renderer.root
    .findAll((node: any) => typeof node.props.onPress === 'function' && node.props.accessibilityRole === role)
    .at(-1);
  TestRenderer.act(() => target.props.onPress({}));
}

describe('new look haptics follow the Vibrace setting', () => {
  beforeEach(() => jest.mocked(fireSelectionHaptic).mockClear());

  it.each([true, false])('Press and Toggle vibrate only when haptics are on (%s)', (on) => {
    useSettingsStore.setState({ hapticEnabled: on });
    const changed = jest.fn();
    tap(<Press haptic accessibilityRole="button" onPress={() => undefined} />, 'button');
    tap(<Toggle value={false} onChange={changed} />, 'switch');
    expect(changed).toHaveBeenCalledWith(true);
    expect(fireSelectionHaptic).toHaveBeenCalledTimes(on ? 2 : 0);
  });
});
