import React from 'react';
import { act, render } from '@testing-library/react-native';

import type { DiceState } from '@/games/web/dice/rules';

let mockGameHostProps: {
  options?: Record<string, unknown>;
  onState?: (state: unknown) => void;
} | null = null;

jest.mock('@/components/shared/PersonAvatar', () => ({ PersonAvatar: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('react-native-reanimated', () => {
  const ReactModule = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactModule.createElement(View, props, children),
    },
    FadeIn: { duration: () => undefined },
    FadeOut: { duration: () => undefined },
    useReducedMotion: () => false,
  };
});
jest.mock('@/games/GameHost', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  return {
    GAME_HOST_AVAILABLE: true,
    GameHost: ReactModule.forwardRef((props: typeof mockGameHostProps, _ref) => {
      mockGameHostProps = props;
      return null;
    }),
  };
});
jest.mock('@/games/GameResult', () => ({ GameResult: () => null }));

const { startDice, recordRoll } = jest.requireActual('@/games/web/dice/rules') as typeof import('@/games/web/dice/rules');
const { DiceDuelShell } = jest.requireActual('@/party/shells/DiceDuelShell') as typeof import('@/party/shells/DiceDuelShell');

const PLAYERS = [
  { id: 'me', name: 'Ty', tint: '#111' },
  { id: 'honza', name: 'Honza', tint: '#222' },
];

it('keeps the latest local state in GameHost options so a WebView retry can resume', () => {
  render(
    <DiceDuelShell players={PLAYERS} onFinished={jest.fn()} onDone={jest.fn()} />,
  );
  const initial = startDice(PLAYERS);
  expect(mockGameHostProps?.options).toEqual({ count: 2, state: initial });

  const afterFirstRoll: DiceState = recordRoll(initial, 'me', [6, 4]);
  act(() => mockGameHostProps?.onState?.(afterFirstRoll));

  expect(mockGameHostProps?.options).toEqual({ count: 2, state: afterFirstRoll });
});
